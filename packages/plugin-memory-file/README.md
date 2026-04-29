# @eden/plugin-memory-file

基于文件系统的轻量记忆插件。每次对话后追加到 JSONL 文件，下次请求时注入相关记忆。

## 安装

```bash
pnpm add @eden/plugin-memory-file
```

## 使用

在 Profile 配置中声明：

```yaml
plugins:
  - name: "@eden/plugin-memory-file"
    config:
      path: "memory/"        # 相对于 profile 目录
      maxTokens: 300        # 最大注入 tokens
```

## 工作原理

- **onPreProcess**: 读取 `memory/memory.jsonl`，通过关键词匹配注入相关记忆
- **onPostProcess**: 将本次对话追加到 `memory/memory.jsonl`

## 存储格式

```jsonl
{"timestamp":"2026-04-29T10:00:00.000Z","role":"user","content":"我想写一个武侠小说"}
{"timestamp":"2026-04-29T10:00:30.000Z","role":"assistant","content":"好的，武侠小说开始。"}
```

## 注入示例

```typescript
// 注入到 ProcessContext 的内容
{
  source: "memory-file",
  content: "[memory] 用户偏好：主角姓林，用剑，性格孤傲\n[memory] 上次情节：林远在长安城被追杀",
  tokens: 45,
  metadata: { entries: 2 }
}
```