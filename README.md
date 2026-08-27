# 链接清理器 Cloudflare 版

这个目录可以把链接清理页面和短链接解析接口一起部署到 Cloudflare Workers。当前配置会把 `https://beetya.ng/link` 路径交给 Worker，部署完成后不需要再运行本地 `link-cleaner-server.mjs`。

## 首次部署

在 PowerShell 中执行：

```powershell
cd "C:\Users\beetm\Documents\Laptop Recommendation\dashboard\cloudflare"
npx wrangler@latest login
npx wrangler@latest deploy
```

首次登录会打开 Cloudflare 授权页面。部署完成后，命令行会输出一个 `workers.dev` 地址；以后直接打开这个地址即可。

## 本地预览

```powershell
cd "C:\Users\beetm\Documents\Laptop Recommendation\dashboard\cloudflare"
npx wrangler@latest dev
```

## 支持范围

- 淘宝/天猫：保留 `id` 和 `skuId`。
- 京东 PC：保留到 `.html`。
- 京东移动链接：转换为 `https://item.jd.com/<SKU>.html`。
- 京东 `u.jd.com`、`3.cn` 和 B 站 `b23.tv`：先由 Worker 解析跳转，再清理结果。
- B 站视频：保留 BV 号和时间参数 `t`；分 P 参数 `p` 会移除。

短链接解析接口只接受 `u.jd.com`、`3.cn`、`b23.tv`，并且会校验最终目标域名，避免把接口用作任意网址代理。
