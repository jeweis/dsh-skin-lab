# dsh-skin-lab

DeepSeek Harness 主题插件：提供 10 套内置主题（6 套抽象色彩场 + 4 套手绘水彩插画），支持自由组合配色、背景与风格元素。

## 🚀 快速开始

1. 在 DeepSeek Harness 中打开 **插件** 页面
2. 输入 GitHub 地址：`https://github.com/jeweis/dsh-skin-lab`
3. 点击 **安装**

安装完成后自动应用「深海」主题（深海青配色 + 深海背景 + 玻璃质感 + 柔和阴影 + Logo 跟随强调色）。

## 🎨 使用方式

安装后进入 **设置 → 主题** 查看所有选项：

- **主题**：直接切换 10 套预设主题（每套包含配色+背景+风格）
- **配色**：独立更换 6 套配色（不影响当前背景）
- **背景**：选择 10 张内置图 / 纯色 / 渐变 / 自定义图片（支持本机上传或粘贴 URL）
- **风格元素**：开启/关闭 Logo 跟随强调色、隐藏字标、自定义 Logo、玻璃质感、阴影类型
- **恢复官方外观**：一键撤销所有主题覆盖

> 提示：插件会自动为用户上传的图片添加智能遮罩以保证文字可读性；内置主题已预配对浅色/深色两版背景，切换系统主题时无需遮罩。

## 🔧 重置

想恢复 DeepSeek Harness 原始外观？在设置页点击 **恢复官方外观** 按钮即可。

## 📦 本地开发（可选）

构建产物 `lib/` 与 `src/assets.js` **已随仓库提交**，因此从 GitHub 安装时无需构建。

```bash
# 一次性重建产物：内嵌 assets/*.jpg → src/assets.js，再由 src/ 生成 lib/
node scripts/embed-assets.mjs
node scripts/build.mjs

# 运行验证
node verify.mjs
```

改动 `assets/` 下的图片后，请重新执行上面两条命令并把重新生成的 `src/assets.js`、`lib/` 一起提交：
本插件以 git 依赖方式安装，而 pnpm 自 10.26 起默认禁止 git 依赖执行 `prepare`（[pnpm/pnpm#10288](https://github.com/pnpm/pnpm/pull/10288)），
所以安装时不会自动构建——仓库里缺了 `lib/`，插件就会因为入口文件不存在而无法加载。
