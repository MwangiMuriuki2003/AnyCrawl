# Docker 中的数据库迁移方案

## 背景

当前 `drizzle-kit` 在 `devDependencies` 中，但在 Docker 生产环境中需要执行数据库迁移。由于生产环境使用 `pnpm install --prod`，会跳过 devDependencies，导致 migration 失败。

## 方案一：多阶段构建（已实施）

### 实现步骤

1. **Dockerfile 修改**：

    - 添加专门的 `migration` 阶段，保留 devDependencies
    - 在 runtime 阶段复制 migration 所需的文件和 node_modules
    - 确保 drizzle-kit 可以在生产环境执行

2. **脚本修改**：
    - 在 `packages/db/package.json` 添加 `db:migrate:docker` 脚本
    - 修改 `docker-entrypoint.sh` 使用新的 migration 命令

### 优点

- 保持 drizzle-kit 在 devDependencies，符合语义
- 只在需要时包含 migration 工具
- 生产镜像仍然精简

### 缺点

- Dockerfile 稍微复杂
- 需要额外的构建阶段

## 方案二：移动到 dependencies（备选）

如果希望简化流程，可以将 drizzle-kit 移到 dependencies：

```json
// packages/db/package.json
{
    "dependencies": {
        "@anycrawl/libs": "workspace:*",
        "drizzle-orm": "^0.43.1",
        "drizzle-kit": "^0.31.1", // 移动到这里
        "better-sqlite3": "^11.9.1",
        "pg": "^8.15.6"
    },
    "devDependencies": {
        // 移除 drizzle-kit
    }
}
```

### 优点

- 简单直接
- 不需要修改 Dockerfile
- 随时可以执行 migration

### 缺点

- drizzle-kit 会包含在生产环境中
- 增加生产镜像大小
- 不符合 devDependencies 的语义

## 使用方式

### 本地开发

```bash
pnpm db:migrate
```

### Docker 环境

Migration 会在容器启动时自动执行（首次或设置 MIGRATE_DATABASE=true）

### 手动执行

```bash
docker exec -it <container-id> sh -c "cd /usr/src/app/packages/db && npm run db:migrate:docker"
```

## 环境变量

- `MIGRATE_DATABASE`: 设置为 `true` 强制执行 migration
- `ANYCRAWL_API_DB_TYPE`: 数据库类型（sqlite/postgresql）
- `ANYCRAWL_API_DB_CONNECTION`: 数据库连接字符串
