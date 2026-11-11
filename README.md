# OneName 角色聊天

一个在手机浏览器里就能用的 AI 角色聊天网页。纯前端，不需要服务器，角色和聊天记录只保存在你自己的浏览器里。

## 功能

- 创建角色：名字、头像、年龄、性格设定、场景、开场白、示例对话
- 导入角色卡（SillyTavern / TavernAI 的 PNG 或 JSON 格式）
- 聊天：流式输出，`*星号*` 里的动作描写会显示成斜体；可以停止、重新生成、撤销、导出聊天记录
- 两种模型来源：
  - **手机本地运行**：用 [wllama](https://github.com/ngxson/wllama)（llama.cpp 的 WebAssembly 版）在浏览器里跑 GGUF 模型，离线可用，内容不上传
  - **在线 API**：任何兼容 OpenAI 格式的接口
- 可编辑系统提示词、温度、回复长度、上下文长度
- 备份 / 恢复全部数据（JSON）
- 只允许成年角色：年龄必须 ≥ 18，设定里出现涉及未成年人的描述会被拒绝保存

## 部署到手机（GitHub Pages，免费）

1. 打开仓库的 **Settings → Pages**
2. Source 选 **Deploy from a branch**，分支选这个分支（或合并到 main 后选 main），目录选 `/ (root)`，保存
3. 等一两分钟，页面会给出网址，形如 `https://<用户名>.github.io/onename/`
4. 用安卓 Chrome 打开，菜单里选「添加到主屏幕」，就像 App 一样使用

> 私有仓库开 Pages 需要付费的 GitHub 套餐；免费账号要把仓库设为公开。不想公开也可以部署到 Cloudflare Pages、Netlify 等免费静态托管。

## 选模型（本地运行）

- 在 [Hugging Face](https://huggingface.co) 找 **GGUF** 格式的模型，选文件名带 `Q4_K_M` 的版本
- 单个文件要小于 **2GB**（浏览器限制），所以手机上建议 1B～4B 的模型
- 复制文件链接粘贴到设置里（`/blob/` 的页面链接会自动转成下载链接），点「下载并加载」。下载一次后会缓存，之后打开网页不用重新下载
- 也可以先把 `.gguf` 文件下载到手机，再用「从手机文件里选」加载
- 中文聊天优先选中文能力好的模型（比如 Qwen 系列及其角色扮演微调版）

## 本地开发

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

`coi.js` 通过 service worker 给页面加上跨源隔离头，让 wasm 可以多线程运行（GitHub Pages 本身不支持设置这些头）。不支持的浏览器会自动退回单线程。
