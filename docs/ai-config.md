### AnyCrawl AI 配置与使用指南

本文档介绍在 AnyCrawl 中如何配置与使用 LLM 提供商（providers）、模型映射（modelMapping）以及默认模型（defaults），并给出完整示例与最佳实践。

---

### 配置模式与环境变量模式

- **配置文件模式（推荐）**

    - 设置环境变量 `ANYCRAWL_AI_CONFIG_PATH` 指向你的 `ai.config.json` 文件后，程序将按该文件进行解析。
    - 特性：支持任意数量与命名的 provider；支持按 `modelMapping` 顺序与启用状态自动挑选 provider；支持在 defaults 中使用“模型键”或 `provider/modelId` 直连。

- **环境变量模式**（未设置 `ANYCRAWL_AI_CONFIG_PATH`）
    - 通过环境变量注册内置 provider：`openai`、`openrouter`、`custom`（仅 1 个）。
    - 此模式下的默认模型应使用完整的 `provider/modelId` 形式，例如：`openai/gpt-4o`。

示例：

```bash
export ANYCRAWL_AI_CONFIG_PATH="/absolute/path/to/ai.config.json"
```

---

### ai.config.json Schema

- `providers`: 定义 provider 凭据与启用状态（键名自定义，需与下文 `modelMapping[].providers[].provider` 对应）

    - 字段：
        - `enabled`: 是否启用该 provider
        - `apiKey` 或 `apiKeyEnv`: 直接写密钥，或引用环境变量名（推荐）
        - `baseURL` 或 `baseURLEnv`: API 基地址，或引用环境变量名
    - 注意：在配置文件模式下，只有同时具备有效 `apiKey` 与 `baseURL` 时才会被注册（包括 `openai`）。

- `modelMapping`: 将“模型键”（如 `gpt-4o`、`gpt-5-mini`）映射到不同 provider 对应的 `modelId`

    - 字段：
        - `displayName`: 展示名
        - `providers`: 顺序很重要！按此数组顺序与顶层 `providers.enabled` 选取第一个可用的 provider
            - `provider`: 须与顶层 `providers` 的键名一致
            - `modelId`: 该 provider 下的模型标识（如 `gpt-4o`、`openai/gpt-4o` 等）

- `defaults`: 默认模型
    - `DEFAULT_LLM_MODEL`: 可填“模型键”（走自动选择）或直接填完整 `provider/modelId`
    - `DEFAULT_EXTRACT_MODEL`（可选）：抽取场景默认模型；未设置时回退到默认 LLM；同样支持“模型键”与 `provider/modelId`
    - 备注：若你在文件中写了 `RETRY_EXTRACT_MODEL`，当前代码未使用该字段

最小示例：

```json
{
    "providers": {
        "openai": {
            "enabled": true,
            "apiKeyEnv": "OPENAI_API_KEY",
            "baseURL": "https://api.openai.com/v1"
        },
        "openrouter": {
            "enabled": true,
            "apiKeyEnv": "OPENROUTER_API_KEY",
            "baseURL": "https://openrouter.ai/api/v1"
        },
        "my-custom": {
            "enabled": true,
            "apiKeyEnv": "MY_CUSTOM_API_KEY",
            "baseURLEnv": "MY_CUSTOM_BASE_URL"
        }
    },
    "modelMapping": {
        "gpt-5-mini": {
            "displayName": "GPT-5 Mini",
            "providers": [
                { "provider": "openai", "modelId": "gpt-5-mini" },
                { "provider": "openrouter", "modelId": "openai/gpt-5-mini" },
                { "provider": "my-custom", "modelId": "gpt-5-mini" }
            ]
        }
    },
    "defaults": {
        "DEFAULT_LLM_MODEL": "gpt-5-mini",
        "DEFAULT_EXTRACT_MODEL": "gpt-5-mini"
    }
}
```

在配置文件中直接使用 `provider/modelId`（绕过 `modelMapping` 顺序挑选）：

```json
{
    "defaults": {
        "DEFAULT_LLM_MODEL": "openrouter/openai/gpt-4o",
        "DEFAULT_EXTRACT_MODEL": "my-custom/gpt-5-mini"
    }
}
```

上述写法会直接固定到对应 provider，不再依据 `modelMapping` 的 `providers` 顺序解析。

---

### Provider 选择规则（配置文件模式）

- 当你传入“模型键”（例如 `gpt-5-mini`），系统会：

    - 读取 `modelMapping['gpt-5-mini'].providers` 并按顺序查找
    - 在顶层 `providers` 中找到与之同名且 `enabled: true` 且凭据完整的 provider
    - 返回最终模型 ID（形如 `provider/modelId`）并使用该 provider

- 如果你希望强制使用某个 provider，可直接在 defaults 或调用处传入完整的 `provider/modelId`。

---

### 多个自定义 Provider 的配置

- 在配置文件模式下，`providers` 的键名不固定，可以配置多个、任意命名：

```json
{
    "providers": {
        "custom-a": { "enabled": true, "apiKeyEnv": "CUST_A_KEY", "baseURLEnv": "CUST_A_URL" },
        "custom-b": { "enabled": true, "apiKeyEnv": "CUST_B_KEY", "baseURLEnv": "CUST_B_URL" }
    },
    "modelMapping": {
        "gpt-5-mini": {
            "displayName": "GPT-5 Mini",
            "providers": [
                { "provider": "custom-a", "modelId": "gpt-5-mini" },
                { "provider": "custom-b", "modelId": "gpt-5-mini" }
            ]
        }
    },
    "defaults": { "DEFAULT_LLM_MODEL": "gpt-5-mini" }
}
```

- 在环境变量模式下，仅内置一个名为 `custom` 的自定义 provider；如需多个自定义 provider，建议使用配置文件模式。

---

### 环境变量模式配置要点

- 可用环境变量（按需）：

    - `OPENAI_API_KEY`
    - `OPENROUTER_API_KEY`、`OPENROUTER_BASE_URL`（默认 `https://openrouter.ai/api/v1`）
    - `CUSTOM_API_KEY`、`CUSTOM_BASE_URL`
    - `DEFAULT_LLM_MODEL`: 需填写完整 `provider/modelId`（例如 `openai/gpt-4o`）
    - `DEFAULT_EXTRACT_MODEL`（可选）

- 注意：在该模式下不会读取 `ai.config.json` 与 `modelMapping`。

---

### 代码使用（TypeScript）

常用 API 位于 `@anycrawl/ai`：

```ts
import { getLLM, getLLMByModel, getDefaultLLM } from "@anycrawl/ai";

// 1) 使用默认 LLM（配置文件模式：从 defaults.DEFAULT_LLM_MODEL 解析；
//    环境变量模式：使用 DEFAULT_LLM_MODEL 的 provider/modelId）
const llmDefault = getDefaultLLM();

// 2) 基于“模型键”选择（配置文件模式按顺序选第一个启用 provider）
const llmByKey = getLLMByModel("gpt-5-mini");

// 3) 强制指定 provider（两种模式通用）
const llmForced = getLLM("openrouter/openai/gpt-4o");
```

工具函数（来自 `utils/helper`）：

```ts
import {
    getAvailableModels,
    getEnabledProviderModels,
    getEnabledModelIdByModelKey,
    getDefaultLLModelId,
    getExtractModelId,
} from "@anycrawl/ai";

// 获取可用模型（用于前端下拉等）
const options = getAvailableModels();

// 调试 provider 启用情况
const enabled = getEnabledProviderModels();

// 解析默认/抽取模型（返回 provider/modelId）
const defaultModelId = getDefaultLLModelId();
const extractModelId = getExtractModelId();
```

---

### 常见问题与最佳实践

- **避免明文密钥**：优先使用 `apiKeyEnv`、`baseURLEnv` 与环境变量，不要把密钥提交到仓库。
- **OpenAI 也需要 baseURL**（配置文件模式）：未提供 `baseURL` 则不会注册该 provider。
- **defaults 的填写**：
    - 若写“模型键”（如 `gpt-5-mini`），将按 `modelMapping` 顺序与启用状态挑选 provider。
    - 也可直接写 `provider/modelId` 固定 provider，例如 `openrouter/openai/gpt-4o`。
- **字段兼容性**：如果在配置文件中看到 `RETRY_EXTRACT_MODEL`，当前实现未使用它。

---

### 参考文件

- 代码位置：
    - `packages/ai/src/utils/helper.ts`（解析与工具函数）
    - `packages/ai/src/ProviderRegistry.ts`（provider 注册与获取 LLM 的入口）
    - `ai.config.example.json`（示例配置）
