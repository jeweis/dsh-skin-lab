# 开发与分发说明

本文件面向维护者。README 面向使用者，请不要把构建/打包细节写进去。

## 构建产物必须入库

```
node scripts/embed-assets.mjs   # assets/*.jpg + assets/lightness.json -> src/assets.js
node scripts/build.mjs          # src/ -> lib/
node verify.mjs                 # 校验产物行为
```

`src/assets.js` 与 `lib/` 是生成物，但**必须提交**。原因是 DSH 以 git 依赖（`github:jeweis/dsh-skin-lab`）
方式安装：拿到的是一份快照，安装过程不构建，而 `package.json` 的 `main` 和
`exports["./client"]` 直接指向 `lib/`。产物不入库，装出来的包就没有入口文件：

```
.dsh/profiles/desktop/node_modules/dsh-skin-lab/lib/index.js   -> 不存在
```

代价是历史增长：`lib/client.js` 是单文件，把每张背景图以 base64 内嵌，约 3.8 MB，
每次改图都会新增一份。这是「能装上」的必要成本。

## 不要添加 `prepare` / `postinstall`

pnpm 自 10.26 起对 git 依赖的构建脚本做了硬限制（[pnpm/pnpm#10288](https://github.com/pnpm/pnpm/pull/10288)）：
包只要声明了 `prepare`，又没被**安装方**的 `allowBuilds` 放行，安装就会直接失败。

```
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] Failed to prepare git-hosted package
fetched from ".../tar.gz/<sha>": The git-hosted package "dsh-skin-lab@x.y.z"
needs to execute build scripts but is not in the "allowBuilds" allowlist.
```

也就是说，声明 `prepare` 不会让构建自动发生，只会让插件装不上——比缺产物更糟。
DSH 用户填入插件地址时不会去改 `allowBuilds`，所以这条路对本插件不可用。
`v0.2.1` 曾经加过，随即在 `v0.2.2` 移除。

## `private` 保持 `true`

npm registry 上的 `dsh-skin-lab` 是**另一个无关的第三方插件**
（维护者 `soarguo`，仓库 `soarGuo/dsh-skin-lab`）。本包不发布到 registry，
`"private": true` 是防误发的护栏，不要移除。

因此 `files` 字段在本包静默安装路径上没有作用，它只在改用别的包名发布时才有意义。
若将来确实要发布，需要先换一个可用的包名（例如 scoped 的 `@jeweis/dsh-skin-lab`），
并同步修改 `cordis.patch.yml` 里的 `name` 与 `dsh.bundle` 的引用。

## 发布新版本

```bash
node scripts/embed-assets.mjs && node scripts/build.mjs && node verify.mjs
# 同步升 package.json 的 version
git add -A && git commit
git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
```

DSH 从 `main` 安装，用例如 `github:jeweis/dsh-skin-lab#vX.Y.Z` 可固定到某个 tag。
