# Ubuntu 24.04 部署

网站为纯静态站点。发布包内置幂等部署脚本，并提供从公开 GitHub Release 下载、校验和部署的一键入口。HTTP 首次部署使用 Nginx；绑定域名后可切换到 Caddy，由 Caddy 自动申请并续期 HTTPS 证书。

## 推荐的服务器文件位置

不需要通过面板文件管理器手工上传到根目录。以截图中的 `ubuntu` 用户登录后，可停留在 `/home/ubuntu` 执行命令；脚本会使用以下位置：

```text
/var/www/nw-desertification/
├── releases/<UTC时间戳>/     每次部署的完整静态网站
└── current -> releases/...   Nginx 当前使用的原子切换软链接

/etc/nginx/sites-available/nw-desertification   Nginx 配置
/etc/nginx/sites-enabled/nw-desertification     启用配置的软链接
/tmp/nw-desertification.*                        临时下载目录，结束时自动删除
```

如云硬盘专门挂载在 `/data`，可在命令中增加 `--site-base /data/www/nw-desertification`；否则建议保留默认的 `/var/www/nw-desertification`。

## 从 GitHub 一键下载并部署

在服务器左侧 Shell 中直接粘贴以下一行。它会安装基础下载工具，从 GitHub Release `v1.0.0` 下载发布包，验证 SHA-256，然后安装 Nginx 并部署：

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates && curl --http1.1 --retry 5 --retry-all-errors -fsSL https://raw.githubusercontent.com/XCodeSky/northwest-desertification/main/deploy/ubuntu24/deploy-from-github.sh | sudo bash -s -- --release v1.0.0
```

部署完成后访问 `http://服务器公网IP/`。云服务商安全组和主机防火墙需要允许入站 TCP 80。

如需先审阅脚本再运行：

```bash
curl --http1.1 --retry 5 --retry-all-errors -fL https://raw.githubusercontent.com/XCodeSky/northwest-desertification/main/deploy/ubuntu24/deploy-from-github.sh -o /tmp/deploy-from-github.sh
less /tmp/deploy-from-github.sh
sudo bash /tmp/deploy-from-github.sh --release v1.0.0
```

## 服务器 IP 访问

```bash
tar -xzf northwest-desertification-site-1.0.0.tar.gz
cd website
sudo bash deploy/ubuntu24/deploy.sh
```

脚本会安装 Nginx 和 rsync、运行完整性检查、创建带时间戳的发布目录、原子切换当前版本并检查 `/healthz`。

## 使用 Caddy 启用域名和 HTTPS（推荐）

先完成 HTTP 部署，并确认域名的 A 记录（有 IPv6 时还包括 AAAA 记录）已指向服务器公网地址。腾讯云安全组必须放行入站 TCP 80 和 443。然后在解压后的项目目录运行：

```bash
cd /home/ubuntu/nw-deploy-v1.0.0/website
sudo bash deploy/ubuntu24/enable-caddy-https.sh \
  --domain desert.example.org \
  --email admin@example.org
```

脚本会验证现有 `/var/www/nw-desertification/current/index.html`，安装 Caddy，备份 `/etc/caddy/Caddyfile`，停止并禁用占用 80 端口的 Nginx，然后让 Caddy 自动申请证书。证书续期由 Caddy 自动完成。邮箱可省略；域名不可省略，公网 IP 地址不能用于常规受信任证书。

验证命令：

```bash
curl -I https://desert.example.org/
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 100 --no-pager
```

如签发失败，脚本会恢复原 Caddyfile 并重新启动 Nginx。最常见原因是域名尚未解析到本机、公网 80/443 未放行，或者 AAAA 记录指向了错误的 IPv6 地址。

## 使用 Nginx + Certbot 启用 HTTPS（备选）

先把域名 A/AAAA 记录指向服务器，再执行：

```bash
curl --http1.1 --retry 5 --retry-all-errors -fL https://raw.githubusercontent.com/XCodeSky/northwest-desertification/main/deploy/ubuntu24/deploy-from-github.sh -o /tmp/deploy-from-github.sh
sudo bash /tmp/deploy-from-github.sh --release v1.0.0 \
  --domain desert.example.org \
  --https \
  --email admin@example.org
```

此模式使用 Certbot 申请 Let's Encrypt 证书，需要公网开放 80/443 端口；不要与 Caddy 模式同时启用。

## 天地图密钥

天地图浏览器端密钥会公开在前端代码中，应在控制台设置域名白名单。可在部署时通过环境变量注入，脚本不会打印密钥：

```bash
sudo env TIANDITU_TK='你的浏览器端密钥' \
  bash /tmp/deploy-from-github.sh --release v1.0.0 --domain desert.example.org
```

不提供密钥时使用项目自带的简化示意底图。

## 选项

```text
--domain NAME       Nginx server_name，默认 _（服务器 IP）
--site-base PATH    发布目录，默认 /var/www/nw-desertification
--release TAG       GitHub Release 标签，默认 v1.0.0
--https             使用 Certbot 配置 HTTPS
--email ADDRESS     HTTPS 证书通知邮箱
--skip-packages     不运行 apt，适用于依赖已安装的服务器
```

重复运行会生成新发布目录并原子切换。旧版本保留在 `<site-base>/releases/`。部署脚本不会修改防火墙或云安全组；请开放 TCP 80，启用 HTTPS 时同时开放 443。
