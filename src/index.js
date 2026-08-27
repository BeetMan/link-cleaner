const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36";
const MAX_INPUT_LENGTH = 2048;
const MAX_REDIRECT_HTML_BYTES = 256 * 1024;
const ALLOWED_SHORT_HOSTS = new Set(["u.jd.com", "3.cn", "b23.tv"]);
const APP_PATH = "/link";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function hostMatchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function normalizeShortUrl(rawValue) {
  const value = rawValue.trim();
  if (!value || value.length > MAX_INPUT_LENGTH) {
    throw new Error("短链接为空或长度超过限制。");
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  const parsed = new URL(withProtocol);
  const hostname = parsed.hostname.toLowerCase();

  if (!ALLOWED_SHORT_HOSTS.has(hostname)) {
    throw new Error("只允许解析京东和 B 站短域名（u.jd.com、3.cn、b23.tv）。");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("只支持 http 或 https 短链接。");
  }
  return parsed;
}

function isAllowedDestination(shortUrl, candidateUrl) {
  const shortHost = shortUrl.hostname.toLowerCase();
  const destinationHost = candidateUrl.hostname.toLowerCase();

  if (shortHost === "b23.tv") {
    return hostMatchesDomain(destinationHost, "bilibili.com");
  }
  return hostMatchesDomain(destinationHost, "jd.com");
}

function validateDestination(shortUrl, rawDestination) {
  const destination = new URL(rawDestination, shortUrl);
  if (!['http:', 'https:'].includes(destination.protocol)) {
    throw new Error("短链接返回了不支持的跳转协议。");
  }
  if (!isAllowedDestination(shortUrl, destination)) {
    throw new Error("短链接返回了不在允许范围内的目标地址。");
  }
  return destination.toString();
}

function decodeJavaScriptString(value) {
  return value
    .replaceAll("\\'", "'")
    .replaceAll("\\/", "/")
    .replaceAll("\\\\", "\\");
}

async function readTextLimited(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("短链接返回内容过大，已停止解析。");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("短链接返回内容过大，已停止解析。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function resolvePromotionShortUrl(rawValue) {
  const shortUrl = normalizeShortUrl(rawValue);
  const firstResponse = await fetch(shortUrl, {
    headers: { "user-agent": USER_AGENT },
    redirect: "manual",
  });
  const firstCookie = firstResponse.headers.get("set-cookie") || "";
  const directLocation = firstResponse.headers.get("location");
  if (directLocation) {
    return validateDestination(shortUrl, directLocation);
  }

  const body = await readTextLimited(firstResponse, MAX_REDIRECT_HTML_BYTES);
  const hrlMatch = body.match(/var\s+hrl\s*=\s*(['"])([^'"]+)\1/);
  if (!hrlMatch) {
    throw new Error("没有找到短链的跳转目标。");
  }

  const jumpUrl = new URL(decodeJavaScriptString(hrlMatch[2]), shortUrl);
  const jumpResponse = await fetch(jumpUrl, {
    headers: {
      cookie: firstCookie,
      "user-agent": USER_AGENT,
    },
    redirect: "manual",
  });
  const finalLocation = jumpResponse.headers.get("location");
  if (!finalLocation) {
    throw new Error("短链没有返回最终跳转地址。");
  }
  return validateDestination(shortUrl, finalLocation);
}

async function handleResolve(request) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "只支持 GET 请求。" }, 405);
  }

  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get("url");
  if (!rawUrl) {
    return jsonResponse({ error: "缺少 url 参数。" }, 400);
  }

  try {
    const resolvedUrl = await resolvePromotionShortUrl(rawUrl);
    return jsonResponse({ resolvedUrl });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "解析失败。" },
      400,
    );
  }
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/api/resolve") {
      return handleResolve(request);
    }
    if (requestUrl.pathname === `${APP_PATH}/api/resolve`) {
      return handleResolve(request);
    }

    if (requestUrl.pathname === APP_PATH) {
      return Response.redirect(new URL(`${APP_PATH}/`, request.url), 308);
    }
    if (requestUrl.pathname.startsWith(`${APP_PATH}/`)) {
      const assetUrl = new URL(request.url);
      const requestedAssetPath = requestUrl.pathname.slice(APP_PATH.length) || "/";
      if (["/", "/index.html"].includes(requestedAssetPath)) {
        assetUrl.pathname = "/link-page.txt";
        const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
        const headers = new Headers(assetResponse.headers);
        headers.set("content-type", "text/html; charset=utf-8");
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers,
        });
      }
      assetUrl.pathname = requestedAssetPath;
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  },
};
