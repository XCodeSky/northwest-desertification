# Ubuntu 24.04 部署

网站为纯静态站点，推荐使用 Nginx。发布包内置幂等部署脚本。

## 服务器 IP 访问

```bash
tar -xzf northwest-desertification-site-1.0.0.tar.gz
cd website
sudo bash deploy/ubuntu24/deploy.sh
```

脚本会安装 Nginx 和 rsync、运行完整性检查、创建带时间戳的发布目录、原子切换当前版本并检查 `/healthz`。

## 域名和 HTTPS

先把域名 A/AAAA 记录指向服务器，再执行：

```bash
sudo bash deploy/ubuntu24/deploy.sh \
  --domain desert.example.org \
  --https \
  --email admin@example.org
```

HTTPS 模式使用 Certbot 申请 Let's Encrypt 证书，需要公网开放 80/443 端口。

## 天地图密钥

天地图浏览器端密钥会公开在前端代码中，应在控制台设置域名白名单。可在部署时通过环境变量注入，脚本不会打印密钥：

```bash
sudo env TIANDITU_TK='你的浏览器端密钥' \
  bash deploy/ubuntu24/deploy.sh --domain desert.example.org
```

不提供密钥时使用项目自带的简化示意底图。

## 选项

```text
--domain NAME       Nginx server_name，默认 _（服务器 IP）
--site-base PATH    发布目录，默认 /var/www/nw-desertification
--https             使用 Certbot 配置 HTTPS
--email ADDRESS     HTTPS 证书通知邮箱
--skip-packages     不运行 apt，适用于依赖已安装的服务器
```

重复运行会生成新发布目录并原子切换。旧版本保留在 `<site-base>/releases/`。部署脚本不会修改防火墙或云安全组；请开放 TCP 80，启用 HTTPS 时同时开放 443。
