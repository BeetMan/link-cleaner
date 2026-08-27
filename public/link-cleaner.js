const SAFE_EXACT_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "twclid",
  "ttclid",
  "yclid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "_gl",
  "gclsrc",
  "mkt_tok",
  "vero_id",
  "vero_conv",
  "_hsenc",
  "_hsmi",
  "s_cid",
  "igshid",
  "rb_clickid",
  "_openstat",
]);

const SAFE_PREFIXES = [
  "utm_",
  "_ga",
  "_gac_",
  "mc_",
  "_hs",
  "hsa_",
  "mtm_",
  "pk_",
  "piwik_",
];

const EXTENDED_EXACT_PARAMS = new Set([
  "ref",
  "referrer",
  "referer",
  "ref_src",
  "ref_url",
  "source",
  "src",
  "campaign",
  "campaign_id",
  "ad_id",
  "adset_id",
  "creative_id",
  "affiliate",
  "affiliate_id",
  "partner",
  "partner_id",
  "aff",
  "aff_id",
  "subid",
  "sub_id",
  "clickid",
  "click_id",
  "tracking_id",
  "trk",
  "trkid",
  "linkid",
  "link_id",
  "share_source",
  "share_medium",
  "share_campaign",
  "share_tag",
  "share_token",
  "spm",
  "spm_id",
  "spm_id_from",
  "spm_prev",
  "ved",
  "ei",
  "oq",
  "sourceid",
  "si",
]);

const TAOBAO_TMALL_ALLOWED_PARAMS = new Set(["id", "skuid"]);
const BILIBILI_ALLOWED_PARAMS = new Set(["p", "t"]);

const input = document.getElementById("urlInput");
const cleanButton = document.getElementById("cleanButton");
const pasteButton = document.getElementById("pasteButton");
const copyButton = document.getElementById("copyButton");
const resultCard = document.getElementById("resultCard");
const resultUrl = document.getElementById("resultUrl");
const removedCount = document.getElementById("removedCount");
const keptCount = document.getElementById("keptCount");
const lengthChange = document.getElementById("lengthChange");
const removedList = document.getElementById("removedList");
const keptList = document.getElementById("keptList");
const resolvedNote = document.getElementById("resolvedNote");
const inputHint = document.getElementById("inputHint");
const toast = document.getElementById("toast");
const hostedBasePath = window.location.pathname === "/link" || window.location.pathname.startsWith("/link/")
  ? "/link"
  : "";
const SHORT_LINK_RESOLVER_ENDPOINT =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:8787/api/resolve"
    : `${hostedBasePath}/api/resolve`;

let latestCleanUrl = "";
let toastTimer;

function getMode() {
  return document.querySelector('input[name="cleanMode"]:checked')?.value || "safe";
}

function isTrackingParameter(name, mode) {
  const normalizedName = name.trim().toLowerCase();

  if (
    SAFE_EXACT_PARAMS.has(normalizedName) ||
    SAFE_PREFIXES.some((prefix) => normalizedName.startsWith(prefix))
  ) {
    return "高置信度追踪";
  }

  if (mode === "extended" && EXTENDED_EXACT_PARAMS.has(normalizedName)) {
    return "来源/联盟追踪";
  }

  return "";
}

function getMarketplaceRule(parsedUrl) {
  const hostname = parsedUrl.hostname.toLowerCase();
  const isTaobao = hostname === "taobao.com" || hostname.endsWith(".taobao.com");
  const isTmall = hostname === "tmall.com" || hostname.endsWith(".tmall.com");
  const isJdShort = hostname === "u.jd.com" || hostname === "3.cn";
  const isBilibiliShort = hostname === "b23.tv";
  const isJdMobile = hostname === "item.m.jd.com";
  const isJd = hostname === "jd.com" || hostname.endsWith(".jd.com");
  const isBilibili = hostname === "bilibili.com" || hostname.endsWith(".bilibili.com");

  if (isJdShort) {
    return {
      label: "京东短链",
      type: "jd-short",
    };
  }

  if (isJdMobile) {
    return {
      label: "京东移动端 → PC",
      type: "jd-mobile-to-pc",
    };
  }

  if (isBilibiliShort) {
    return {
      label: "B站短链",
      type: "bilibili-short",
    };
  }

  if (isBilibili) {
    return {
      label: "B站视频专用规则",
      type: "bilibili-video",
      allowedParams: BILIBILI_ALLOWED_PARAMS,
    };
  }

  if (isJd) {
    return {
      label: "京东专用规则",
      type: "jd-html-only",
    };
  }

  if (isTaobao || isTmall) {
    return {
      label: isTaobao ? "淘宝专用规则" : "天猫专用规则",
      type: "allowlist",
      allowedParams: TAOBAO_TMALL_ALLOWED_PARAMS,
    };
  }

  return null;
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'，。！？；：、】》」』）\]]+/gi;

function normalizePastedText(value) {
  return value.replace(/\\+([&_=])/g, "$1");
}

function cleanUrlTail(value) {
  let cleaned = value.replace(/[.,!?;:，。！？；：、】》」』”’]+$/g, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const [opening, closing] of [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ]) {
      const openingCount = [...cleaned].filter((character) => character === opening).length;
      const closingCount = [...cleaned].filter((character) => character === closing).length;
      if (cleaned.endsWith(closing) && closingCount > openingCount) {
        cleaned = cleaned.slice(0, -1);
        changed = true;
      }
    }
  }
  return cleaned;
}

function extractUrl(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) {
    throw new Error("请先粘贴一个链接。");
  }

  const normalizedText = normalizePastedText(raw);
  const markdownTarget = normalizedText.match(/\]\(\s*((?:https?:\/\/|www\.)[^\s<>"']+)\s*\)/i);
  const match = markdownTarget?.[1] || normalizedText.match(URL_PATTERN)?.[0];
  const looksLikeBareUrl =
    /^(?:https?:\/\/|www\.)/i.test(normalizedText) ||
    (/^[a-z\d.-]+\.[a-z]{2,}(?:\/|\?|$)/i.test(normalizedText) && !/\s/.test(normalizedText));
  const extracted = cleanUrlTail(match || (looksLikeBareUrl ? normalizedText : ""));

  if (!extracted) {
    throw new Error("没有找到可识别的 http(s) 链接。");
  }

  const urlText = /^www\./i.test(extracted) ? `https://${extracted}` : extracted;
  return {
    urlText,
    extractedFromText: urlText !== raw,
  };
}

function normalizeInput(rawValue) {
  const { urlText, extractedFromText } = extractUrl(rawValue);
  const valueWithProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(urlText) ? urlText : `https://${urlText}`;
  const parsed = new URL(valueWithProtocol);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("目前只支持 http 或 https 网页链接。");
  }

  return { parsed, original: urlText, extractedFromText };
}

function cleanUrl(rawValue, mode) {
  const { parsed, original, extractedFromText } = normalizeInput(rawValue);
  const removed = [];
  const kept = [];
  const marketplaceRule = getMarketplaceRule(parsed);

  if (["jd-short", "bilibili-short"].includes(marketplaceRule?.type)) {
    throw new Error("这是推广短链接，请先启动本地解析助手再清理。");
  }

  if (marketplaceRule?.type === "jd-mobile-to-pc") {
    const htmlMarker = ".html";
    const htmlEnd = parsed.pathname.toLowerCase().indexOf(htmlMarker);
    if (htmlEnd < 0) {
      throw new Error("无法从京东移动端链接中找到 SKU ID。");
    }

    const filenameStart = parsed.pathname.lastIndexOf("/", htmlEnd) + 1;
    const skuFilename = parsed.pathname.slice(filenameStart, htmlEnd + htmlMarker.length);
    for (const [name] of parsed.searchParams.entries()) {
      removed.push({ name, reason: marketplaceRule.label });
    }

    parsed.hostname = "item.jd.com";
    parsed.port = "";
    parsed.pathname = `/${skuFilename}`;
    parsed.search = "";
    parsed.hash = "";

    return {
      original,
      cleaned: parsed.toString(),
      removed,
      kept,
      ruleLabel: marketplaceRule.label,
      extractedFromText,
    };
  }

  if (marketplaceRule?.type === "jd-html-only") {
    for (const [name] of parsed.searchParams.entries()) {
      removed.push({ name, reason: marketplaceRule.label });
    }

    const htmlMarker = ".html";
    const htmlEnd = parsed.pathname.toLowerCase().indexOf(htmlMarker);
    if (htmlEnd >= 0) {
      parsed.pathname = parsed.pathname.slice(0, htmlEnd + htmlMarker.length);
    }
    parsed.search = "";
    parsed.hash = "";

    return {
      original,
      cleaned: parsed.toString(),
      removed,
      kept,
      ruleLabel: marketplaceRule.label,
      extractedFromText,
    };
  }

  if (marketplaceRule?.type === "bilibili-video") {
    const videoMatch = parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i);
    if (!videoMatch) {
      throw new Error("无法从 B 站链接中找到 BV 视频编号。");
    }

    const selected = new Map();
    for (const [name, value] of parsed.searchParams.entries()) {
      const normalizedName = name.trim().toLowerCase();
      if (marketplaceRule.allowedParams.has(normalizedName) && !selected.has(normalizedName)) {
        selected.set(normalizedName, value);
        kept.push({ name: normalizedName, value });
      } else {
        removed.push({ name, reason: marketplaceRule.label });
      }
    }

    const videoParams = new URLSearchParams();
    for (const key of ["p", "t"]) {
      if (selected.has(key)) {
        videoParams.set(key, selected.get(key));
      }
    }

    parsed.hostname = "www.bilibili.com";
    parsed.port = "";
    parsed.pathname = `/video/${videoMatch[1]}/`;
    parsed.search = videoParams.toString();
    parsed.hash = "";

    return {
      original,
      cleaned: parsed.toString(),
      removed,
      kept,
      ruleLabel: marketplaceRule.label,
      extractedFromText,
    };
  }

  if (marketplaceRule?.type === "allowlist") {
    const selected = new Map();

    for (const [name, value] of parsed.searchParams.entries()) {
      const normalizedName = name.trim().toLowerCase();
      if (marketplaceRule.allowedParams.has(normalizedName) && !selected.has(normalizedName)) {
        selected.set(normalizedName, value);
        kept.push({
          name: normalizedName === "skuid" ? "skuId" : "id",
          value,
        });
      } else {
        removed.push({ name, reason: marketplaceRule.label });
      }
    }

    const marketplaceParams = new URLSearchParams();
    for (const key of ["id", "skuid"]) {
      if (selected.has(key)) {
        marketplaceParams.set(key === "skuid" ? "skuId" : "id", selected.get(key));
      }
    }
    parsed.search = marketplaceParams.toString();

    return {
      original,
      cleaned: parsed.toString(),
      removed,
      kept,
      ruleLabel: marketplaceRule.label,
      extractedFromText,
    };
  }

  for (const [name, value] of parsed.searchParams.entries()) {
    const reason = isTrackingParameter(name, mode);
    if (reason) {
      removed.push({ name, reason });
    } else {
      kept.push({ name, value });
    }
  }

  for (const { name } of removed) {
    parsed.searchParams.delete(name);
  }

  return {
    original,
    cleaned: parsed.toString(),
    removed,
    kept,
    ruleLabel: "通用规则",
    extractedFromText,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTags(host, items, emptyText, includeReason = false) {
  if (!items.length) {
    host.innerHTML = `<span class="empty-tag">${emptyText}</span>`;
    return;
  }

  host.innerHTML = items
    .map((item) => {
      const label = includeReason
        ? `<em>${escapeHtml(item.reason)}</em>`
        : `<em>${escapeHtml(item.value || "无值")}</em>`;
      return `<span class="tag">${escapeHtml(item.name)}${label}</span>`;
    })
    .join("");
}

function renderResult(result) {
  latestCleanUrl = result.cleaned;
  resultCard.classList.remove("is-hidden");
  resultUrl.href = result.cleaned;
  resultUrl.textContent = result.cleaned;
  resolvedNote.textContent = [
    result.extractedFromText ? "已从粘贴文本中自动提取链接。" : "",
    result.resolvedFrom ? `已解开推广短链接：${result.resolvedFrom}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  removedCount.textContent = result.removed.length;
  keptCount.textContent = result.kept.length;

  const delta = result.cleaned.length - result.original.length;
  lengthChange.textContent = delta > 0 ? `+${delta}` : delta;

  renderTags(removedList, result.removed, "没有发现可移除的追踪参数。", true);
  renderTags(keptList, result.kept, "没有查询参数，页面地址本身已保留。", false);

  if (result.removed.length) {
    document.getElementById("statusPill").textContent = result.ruleLabel.includes("专用")
      ? `${result.ruleLabel} · 已完成`
      : `已移除 ${result.removed.length} 项`;
    showToast(`已清理 ${result.removed.length} 个追踪参数。`);
  } else {
    document.getElementById("statusPill").textContent = result.ruleLabel.includes("专用")
      ? `${result.ruleLabel} · 已完成`
      : "已经很干净";
    showToast("没有发现当前模式下的追踪参数。", "info");
  }
}

async function resolveShortLink(rawValue) {
  const { original: shortUrl } = normalizeInput(rawValue);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(
      `${SHORT_LINK_RESOLVER_ENDPOINT}?url=${encodeURIComponent(shortUrl)}`,
      { signal: controller.signal },
    );
    const payload = await response.json();
    if (!response.ok || !payload.resolvedUrl) {
      throw new Error(payload.error || "京东短链解析失败。");
    }
    return payload.resolvedUrl;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("本地解析助手响应超时，请确认它正在运行。");
    }
    if (error instanceof TypeError) {
      throw new Error("找不到本地解析助手，请先运行 link-cleaner-server.mjs。");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function handleClean() {
  try {
    const initialInput = normalizeInput(input.value);
    let sourceValue = initialInput.original;
    let resolvedFrom = "";
    if (["jd-short", "bilibili-short"].includes(getMarketplaceRule(initialInput.parsed)?.type)) {
      inputHint.textContent = "正在解开推广短链接……";
      inputHint.style.color = "";
      resolvedFrom = initialInput.original;
      sourceValue = await resolveShortLink(sourceValue);
    }

    renderResult({
      ...cleanUrl(sourceValue, getMode()),
      extractedFromText: initialInput.extractedFromText,
      resolvedFrom,
    });
    inputHint.textContent = "结果已生成；点击结果链接可以检查它是否正常打开。";
    inputHint.style.color = "";
  } catch (error) {
    resultCard.classList.add("is-hidden");
    inputHint.textContent = error.message;
    inputHint.style.color = "#ff9f68";
    input.focus();
  }
}

function showToast(message, type = "success") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.style.borderColor = type === "info" ? "rgba(120, 184, 255, 0.3)" : "rgba(134, 225, 186, 0.3)";
  toast.style.color = type === "info" ? "#dcecff" : "#d7ffe9";
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

async function handlePaste() {
  try {
    input.value = await navigator.clipboard.readText();
    input.focus();
    inputHint.textContent = "已从剪贴板粘贴，确认后点击“清理链接”。";
    inputHint.style.color = "";
  } catch {
    input.focus();
    showToast("浏览器未允许直接读取剪贴板，请使用 Ctrl/Cmd + V。", "info");
  }
}

async function handleCopy() {
  if (!latestCleanUrl) return;

  try {
    await navigator.clipboard.writeText(latestCleanUrl);
    copyButton.textContent = "已复制 ✓";
    showToast("干净链接已复制。", "success");
    window.setTimeout(() => {
      copyButton.textContent = "复制结果";
    }, 1600);
  } catch {
    showToast("复制失败，请手动选中结果链接。", "info");
  }
}

document.querySelectorAll('input[name="cleanMode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    document.querySelectorAll(".mode-option").forEach((option) => {
      option.classList.toggle("is-selected", option.querySelector("input").checked);
    });
    inputHint.textContent =
      getMode() === "safe"
        ? "未知参数会保留，页面功能更不容易被误伤。"
        : "会额外移除常见来源、联盟和分享参数；不确定时建议用安全清理。";
    inputHint.style.color = "";
  });
});

cleanButton.addEventListener("click", handleClean);
pasteButton.addEventListener("click", handlePaste);
copyButton.addEventListener("click", handleCopy);

input.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    handleClean();
  }
});
