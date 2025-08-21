### json_options 说明（/v1/scrape）

`json_options` 用于在抓取页面后，基于 LLM 将页面内容抽取为结构化 JSON。其工作流程：抓取 → 生成 Markdown → 依据 `json_options.schema` 和提示词进行抽取 → 在响应中返回 `json` 字段。

### 触发方式

- 在请求体中设置 `formats` 包含 `"json"`。
- 同时提供 `json_options`。

响应体会包含一个 `json` 字段（仅当请求的 `formats` 含有 `json` 时），其内容为按给定模式抽取的结构化数据。

### 字段定义

- **schema**: JSON Schema（精简版）定义要抽取的数据结构。
    - 支持的 `type`: `object | array | string | number | boolean | null`
    - 当 `type: "object"` 时，可提供 `properties`（对象，键为字段名，值为子 schema）与 `required`（数组，必填字段列表）。
    - 可以在字段 schema 中添加 `description` 以给 LLM 更多上下文（可选）。
- **user_prompt**: 额外的用户提示词，告诉模型抽取重点或约束（可选）。
- **schema_name**: 给这份 schema 命名（可选）。
- **schema_description**: 对这份 schema 的整体说明（可选）。

注意：以上字段都会被传入内部抽取代理。`schema_name` 与 `schema_description` 仅作为提示上下文使用，不会改变返回 JSON 的结构。

### 模型选择

服务使用以下环境变量选择抽取模型：

- `DEFAULT_EXTRACT_MODEL` 若未设置，则回退到 `DEFAULT_LLM_MODEL`；若仍未设置，默认 `gpt-4o`。

### 返回结果

- 当满足触发条件时，响应体会包含 `json` 字段，其结构严格遵循你传入的 `schema`。模型被要求：
    - 仅返回 schema 中定义的字段；
    - 缺失的字段返回 `null`；
    - 不新增任何未定义字段或包裹层级。

### 请求示例（抽取对象结构）

```bash
curl --location 'http://localhost:8080/v1/scrape' \
--header 'Content-Type: application/json' \
--header 'Accept: application/json' \
--header 'Authorization: Bearer <YOUR_TOKEN>' \
--data '{
  "url": "https://docs.firecrawl.dev/introduction",
  "engine": "playwright",
  "formats": ["json"],
  "json_options": {
    "schema_name": "DocIntro",
    "schema_description": "Extract the main title, a short summary, and key sections from the introduction page.",
    "user_prompt": "If multiple versions exist, focus on the current stable content.",
    "schema": {
      "type": "object",
      "properties": {
        "title": { "type": "string", "description": "Page main title" },
        "summary": { "type": "string", "description": "1-3 sentence summary of the page" },
        "sections": {
          "type": "array",
          "description": "Key top-level sections with brief descriptions",
          "items": {
            "type": "object",
            "properties": {
              "heading": { "type": "string" },
              "description": { "type": "string" }
            },
            "required": ["heading"]
          }
        }
      },
      "required": ["title"]
    }
  }
}'
```

### 请求示例（抽取数组结构）

当你希望直接得到列表时，可以将根 schema 设为 `type: "array"`。内部会自动以对象方式包装处理并返回同样的数组内容。

```bash
curl --location 'http://localhost:8080/v1/scrape' \
--header 'Content-Type: application/json' \
--header 'Accept: application/json' \
--header 'Authorization: Bearer <YOUR_TOKEN>' \
--data '{
  "url": "https://docs.firecrawl.dev/introduction",
  "engine": "playwright",
  "formats": ["json"],
  "json_options": {
    "user_prompt": "Extract common FAQs from the page if available.",
    "schema": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "question": { "type": "string" },
          "answer": { "type": "string" }
        },
        "required": ["question", "answer"]
      }
    }
  }
}'
```

### 常见提示

- 一定要在 `formats` 中包含 `"json"`，否则不会返回抽取结果。
- `include_tags`/`exclude_tags` 可与 `json_options` 同时使用，前者影响用于抽取的正文内容范围。
- Schema 越清晰、带有 `description` 的字段越容易得到稳定、一致的结果。
