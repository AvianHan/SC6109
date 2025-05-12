# ElizaOS Plugin

This is an ElizaOS plugin built with the official plugin starter template.

## Development

```bash
# Start development with hot-reloading
npm run dev

# Build the plugin
npm run build

# Test the plugin
npm run test
```

## Publishing

Before publishing your plugin to the ElizaOS registry, ensure you meet these requirements:

1. **GitHub Repository**
   - Create a public GitHub repository for this plugin
   - Add the 'elizaos-plugins' topic to the repository
   - Use 'main' as the default branch

2. **Required Assets**
   - Add images to the `images/` directory:
     - `logo.jpg` (400x400px square, <500KB)
     - `banner.jpg` (1280x640px, <1MB)

3. **Publishing Process**
   ```bash
   # Check if your plugin meets all registry requirements
   npx elizaos plugin publish --test
   
   # Publish to the registry
   npx elizaos plugin publish
   ```

After publishing, your plugin will be submitted as a pull request to the ElizaOS registry for review.

## Configuration

The `agentConfig` section in `package.json` defines the parameters your plugin requires:

```json
"agentConfig": {
  "pluginType": "elizaos:plugin:1.0.0",
  "pluginParameters": {
    "API_KEY": {
      "type": "string",
      "description": "API key for the service"
    }
  }
}
```

Customize this section to match your plugin's requirements.

## Documentation

# @elizaos-plugins/plugin-erc4337

ERC-4337账户抽象钱包插件，用于部署和使用支持ERC-4337标准的智能合约钱包。

## 功能

- 部署账户抽象钱包
- 执行交易（包括转账、合约调用等）
- 支持与其他插件集成

## 配置参数

需要在角色配置文件或环境变量中设置以下参数：

- `ERC4337_RPC_URL`: ERC-4337 兼容的RPC URL
- `ERC4337_FACTORY_ADDRESS`: 账户工厂合约地址
- `ERC4337_ENTRYPOINT_ADDRESS`: EntryPoint合约地址
- `ERC4337_OWNER_PRIVATE_KEY`: (可选) 钱包所有者私钥

## 使用示例

```json
{
  "plugins": [
    "@elizaos-plugins/plugin-erc4337"
  ],
  "settings": {
    "secrets": {
      "ERC4337_RPC_URL": "https://goerli.bundler.example.com",
      "ERC4337_FACTORY_ADDRESS": "0x...",
      "ERC4337_ENTRYPOINT_ADDRESS": "0x...",
      "ERC4337_OWNER_PRIVATE_KEY": "0x..."
    }
  }
}
```

## 可用操作

### deployWallet
部署一个新的账户抽象钱包。

### executeTransaction
通过账户抽象钱包执行交易。

## 故障排除指南

### chainId不匹配问题

如果遇到以下错误：
```
bundler is on chainId 421614, but provider is on chainId 1
```

这表明provider和bundler使用了不同的chainId。本插件自动处理了这个问题，通过以下方式：

1. 在`setupHooks.ts`中拦截`JsonRpcProvider`和`HttpRpcClient`的创建
2. 确保provider的`getNetwork`方法始终返回正确的chainId (421614，Arbitrum Sepolia)
3. 确保所有创建的bundler客户端使用正确的chainId

### gas不足问题

如果遇到以下错误：
```
preVerificationGas is 21000 but must be at least 35xxx
```

这表明gas设置太低。本插件自动处理了这个问题，通过以下方式：

1. 默认设置足够高的gas值：
   - preVerificationGas: 至少40000
   - callGasLimit: 至少1000000 
   - verificationGasLimit: 至少5000000
2. 添加了自动重试机制，在失败时自动增加gas值
3. 智能解析错误消息，提取所需的最小gas值并相应调整

### 完整解决方案

如果仍然遇到问题，请确保：

1. 使用`utils/sendUserOp.ts`中的`sendUserOp`辅助函数发送所有用户操作
2. 确保项目使用Arbitrum Sepolia网络 (chainId: 421614)
3. 确保所有用户操作字段都有正确的值，特别是：
   - sender: 有效的合约地址
   - signature: 有效的十六进制字符串
   - 所有gas相关字段设置足够高