# 部署到 Render（5 分钟）

这个文件夹就是完整的部署包，不含任何个人数据。把它传到 GitHub，Render 会自动识别 `render.yaml`。

## 第 1 步：建一个 GitHub 仓库

1. 打开 [github.com/new](https://github.com/new)
2. 名字随意（例如 `gongwenbao`），选 **Public**
3. 点 **Create repository**

## 第 2 步：把本文件夹的内容传上去

在仓库页点 **Add file → Upload files**，然后：

- **拖动 `jobkit` 这个文件夹本身**（不是点进去选里面的文件）
- 再拖 `Dockerfile`、`requirements.txt`、`render.yaml`

上传后页面上应该显示 `jobkit/studio.py` 这样的带斜杠路径。如果看到散落的 `studio.py`、`app.js`，说明结构被压平了，删掉重传。

## 第 3 步：在 Render 建服务

1. [render.com](https://render.com) 用 GitHub 登录
2. **New + → Blueprint** → 选仓库 → **Apply**
3. 确认 **Instance Type / Compute Plan = Free**
4. 等 2–5 分钟，得到 `https://名字.onrender.com`

## 第 4 步：验证

打开网址，填一个 `ShopBack` 或 `Stripe` 生成一次，约 10–60 秒。

---

## 免费实例

- 每月 750 实例小时，闲置 15 分钟休眠，下次访问等 30–60 秒
- 磁盘临时，重新部署会清空 `libraries/`（只保留最近 40 个）
- 不需要信用卡；如果账单页出现预测金额，检查 Compute Plan 是否为 Free

## 已知限制

- 字节、腾讯、京东等国内大厂**没有公开岗位接口**，无法自动抓取；请用 ShopBack、Stripe、Airbnb、Grab、Notion 这类公司
- 抓取失败时页面会提示，不会生成空库

## 可选：接入 DeepSeek API

在 Render 的 **Environment** 里加一个变量：

- Key: DEEPSEEK_API_KEY
- Value: 你的 DeepSeek API Key（platform.deepseek.com 申请）

作用：根据你的地点和关键词**自动扩写检索词、从内置公司池里挑选公司**，并为岗位生成匹配理由。不配也能用，只是少了这层智能筛选。

一次生成通常只调用 1–2 次，成本约几分钱。
