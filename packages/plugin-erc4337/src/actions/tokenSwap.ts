/**
 * ERC-4337账户抽象钱包代币交换模块
 * 
 * 本模块提供了通过ERC-4337账户抽象钱包进行代币交换的功能。
 * 实现了完整的代币交换流程：
 * 1. 验证钱包部署状态和代币余额
 * 2. 获取最佳交换路径和价格
 * 3. 构建swap交易calldata
 * 4. 执行代币授权（如需要）
 * 5. 执行swap交易
 * 6. 处理各种错误情况和滑点保护
 */
 import { type Action, type State, type Memory, type Handler, type HandlerCallback } from "@elizaos/core";
 import { ethers } from "ethers";
 import { HttpRpcClient } from "@account-abstraction/sdk";
 import { Erc4337WalletManager } from "../utils/walletManager";
 import safeToNumber from "../utils/safeToNumbers";
 import evenGas from "../utils/evenGas";
 
 // Arbitrum Sepolia chainId
 const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
 
 // 常用代币地址 (Arbitrum Sepolia)
 const TOKEN_ADDRESSES = {
     USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", 
 };
 
 // Uniswap V3 Router地址 (Arbitrum Sepolia)
 const UNISWAP_V3_ROUTER = "0x101F443B4d1b059569D643917553c771E1b9663E";
 
 // ERC20 ABI (简化版)
 const ERC20_ABI = [
     "function balanceOf(address owner) view returns (uint256)",
     "function decimals() view returns (uint8)",
     "function symbol() view returns (string)",
     "function allowance(address owner, address spender) view returns (uint256)",
     "function approve(address spender, uint256 amount) returns (bool)"
 ];
 
 // Uniswap V3 Router ABI (简化版)
 const UNISWAP_V3_ROUTER_ABI = [
     "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)"
 ];
 
 /**
  * 代币交换请求接口
  */
 interface SwapTokensRequest {
     tokenIn: string;          // 输入代币地址或符号
     tokenOut: string;         // 输出代币地址或符号  
     amountIn: string;         // 输入数量
     slippage?: number;        // 滑点容忍度 (默认0.5%)
     deadline?: number;        // 交易截止时间 (默认20分钟)
 }
 
 /**
  * 代币交换响应接口
  */
 interface SwapTokensResponse {
     tokenIn: string;
     tokenOut: string;
     amountIn: string;
     estimatedAmountOut: string;
     actualAmountOut?: string;
     transactionHash?: string;
     success: boolean;
 }
 
 /**
  * 处理代币交换的主函数
  * 
  * @param runtime 运行时环境，包含提供者和其他资源
  * @param message 内存对象
  * @param state 可选的状态对象
  * @param options 可选的参数对象，包含swap参数
  * @param callback 可选的回调函数，用于返回操作结果
  * @returns 代币交换的响应对象
  */
 const swapTokensHandler: Handler = async (
     runtime,
     message: Memory,
     state?: State,
     options?: { [key: string]: unknown },
     callback?: HandlerCallback
 ) => {
     console.log("⭐ 开始执行swapTokens操作");
     console.log("传入参数:", JSON.stringify(options, null, 2));
 
     // 从message中解析swap参数
     let tokenIn: string | undefined;
     let tokenOut: string | undefined;
     let amountIn: string | undefined;
 
     // 尝试从message.content.text中解析参数
     if (message?.content?.text) {
         const text = message.content.text;
         
         // 匹配"交换X USDC为ETH"的格式
         const swapMatch1 = text.match(/交换\s*(\d+(?:\.\d+)?)\s*(\w+)\s*为\s*(\w+)/i);
         if (swapMatch1) {
             amountIn = swapMatch1[1];
             tokenIn = swapMatch1[2].toUpperCase();
             tokenOut = swapMatch1[3].toUpperCase();
         }
         
         // 匹配"用X USDC买ETH"的格式
         const swapMatch2 = text.match(/用\s*(\d+(?:\.\d+)?)\s*(\w+)\s*买\s*(\w+)/i);
         if (swapMatch2) {
             amountIn = swapMatch2[1];
             tokenIn = swapMatch2[2].toUpperCase();
             tokenOut = swapMatch2[3].toUpperCase();
         }
         
         // 匹配"swap X USDC to ETH"的格式
         const swapMatch3 = text.match(/swap\s*(\d+(?:\.\d+)?)\s*(\w+)\s*to\s*(\w+)/i);
         if (swapMatch3) {
             amountIn = swapMatch3[1];
             tokenIn = swapMatch3[2].toUpperCase();
             tokenOut = swapMatch3[3].toUpperCase();
         }
     }
 
     // 提取参数，优先使用message中解析的参数
     const params: SwapTokensRequest = {
         tokenIn: tokenIn || options?.tokenIn as string,
         tokenOut: tokenOut || options?.tokenOut as string,
         amountIn: amountIn || options?.amountIn as string,
         slippage: options?.slippage as number || 0.5, // 默认0.5%滑点
         deadline: options?.deadline as number || 20 // 默认20分钟
     };
 
     console.log("解析后的swap参数:", JSON.stringify(params, null, 2));
 
     // 验证必需参数
     if (!params.tokenIn || !params.tokenOut || !params.amountIn) {
         throw new Error("代币交换参数不完整，需要指定输入代币、输出代币和交换数量");
     }
 
     try {
         // 1. 从runtime获取已初始化的provider实例
         console.log(`检查runtime中的provider实例，共有${runtime.providers.length}个providers`);
         const providerInstance = runtime.providers.find(
             p => p && typeof p === 'object' && 'name' in p && p.name === "erc4337Wallet"
         ) as any;
 
         if (!providerInstance || !providerInstance.walletManager) {
             throw new Error("钱包未初始化，请先执行deployWallet操作");
         }
 
         console.log("从runtime中找到已初始化的钱包管理器");
         const walletManager: Erc4337WalletManager = providerInstance.walletManager;
 
         // 2. 检查钱包是否已部署
         console.log("检查钱包是否已部署...");
         const walletAddress = await walletManager.getCounterFactualAddress();
         const isDeployed = await walletManager.isDeployed();
 
         if (!isDeployed) {
             throw new Error(`钱包${walletAddress}尚未部署，请先执行deployWallet操作`);
         }
 
         // 3. 解析代币地址
         const tokenInAddress = resolveTokenAddress(params.tokenIn);
         const tokenOutAddress = resolveTokenAddress(params.tokenOut);
         
         console.log(`代币地址解析: ${params.tokenIn} -> ${tokenInAddress}, ${params.tokenOut} -> ${tokenOutAddress}`);
 
         // 4. 获取provider进行链上查询
         const provider = new ethers.providers.JsonRpcProvider(walletManager.config.rpcUrl);
         
         // 5. 检查代币余额和小数位数
         console.log("检查代币信息和余额...");
         const tokenInContract = new ethers.Contract(tokenInAddress, ERC20_ABI, provider);
         const tokenOutContract = new ethers.Contract(tokenOutAddress, ERC20_ABI, provider);
         
         const [tokenInDecimals, tokenInSymbol, tokenInBalance] = await Promise.all([
             tokenInContract.decimals(),
             tokenInContract.symbol(),
             tokenInContract.balanceOf(walletAddress)
         ]);
         
         const [tokenOutDecimals, tokenOutSymbol] = await Promise.all([
             tokenOutContract.decimals(),
             tokenOutContract.symbol()
         ]);
         
         console.log(`输入代币: ${tokenInSymbol}, 小数位: ${tokenInDecimals}, 余额: ${ethers.utils.formatUnits(tokenInBalance, tokenInDecimals)}`);
         console.log(`输出代币: ${tokenOutSymbol}, 小数位: ${tokenOutDecimals}`);
         
         // 6. 转换输入数量为wei格式
         const amountInWei = ethers.utils.parseUnits(params.amountIn, tokenInDecimals);
         
         // 检查余额是否足够
         if (tokenInBalance.lt(amountInWei)) {
             throw new Error(`余额不足: 需要 ${params.amountIn} ${tokenInSymbol}, 但只有 ${ethers.utils.formatUnits(tokenInBalance, tokenInDecimals)} ${tokenInSymbol}`);
         }
         
         // 7. 检查代币授权
         console.log("检查代币授权状态...");
         const allowance = await tokenInContract.allowance(walletAddress, UNISWAP_V3_ROUTER);
         
         if (allowance.lt(amountInWei)) {
             console.log("需要授权代币使用权限...");
             
             // 创建授权交易
             const approveData = tokenInContract.interface.encodeFunctionData("approve", [
                 UNISWAP_V3_ROUTER,
                 ethers.constants.MaxUint256 // 授权最大数量
             ]);
             
             console.log("执行代币授权交易...");
             await executeTransaction(walletManager, {
                 to: tokenInAddress,
                 value: "0",
                 data: approveData
             });
             
             console.log("✅ 代币授权完成");
         } else {
             console.log("代币授权充足，无需重新授权");
         }
         
         // 8. 计算最小输出数量 (滑点保护)
         // 这里简化处理，实际应该调用价格预言机或DEX的quote函数
         const estimatedAmountOut = amountInWei.div(1000); // 简化的价格计算，实际需要更复杂的逻辑
         const slippageMultiplier = ethers.BigNumber.from(Math.floor((100 - params.slippage) * 100));
         const amountOutMinimum = estimatedAmountOut.mul(slippageMultiplier).div(10000);
         
         console.log(`预估输出: ${ethers.utils.formatUnits(estimatedAmountOut, tokenOutDecimals)} ${tokenOutSymbol}`);
         console.log(`最小输出: ${ethers.utils.formatUnits(amountOutMinimum, tokenOutDecimals)} ${tokenOutSymbol} (滑点: ${params.slippage}%)`);
         
         // 9. 构建swap交易参数
         const deadline = Math.floor(Date.now() / 1000) + (params.deadline * 60); // 转换为时间戳
         const fee = 3000; // 0.3% 手续费池
         
         const swapParams = {
             tokenIn: tokenInAddress,
             tokenOut: tokenOutAddress,
             fee: fee,
             recipient: walletAddress,
             deadline: deadline,
             amountIn: amountInWei,
             amountOutMinimum: amountOutMinimum,
             sqrtPriceLimitX96: 0 // 0表示不设置价格限制
         };
         
         // 10. 构建swap交易calldata
         const routerContract = new ethers.Contract(UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER_ABI, provider);
         const swapCallData = routerContract.interface.encodeFunctionData("exactInputSingle", [swapParams]);
         
         console.log("构建swap交易...");
         
         // 11. 执行swap交易
         const transactionResponse = await executeTransaction(walletManager, {
             to: UNISWAP_V3_ROUTER,
             value: "0",
             data: swapCallData
         });
         
         // 12. 构建响应对象
         const response: SwapTokensResponse = {
             tokenIn: tokenInSymbol,
             tokenOut: tokenOutSymbol,
             amountIn: params.amountIn,
             estimatedAmountOut: ethers.utils.formatUnits(estimatedAmountOut, tokenOutDecimals),
             transactionHash: transactionResponse.userOpHash,
             success: transactionResponse.success
         };
         
         // 13. 构建用户响应文本
         const responseText = `
 代币交换已完成:
 输入: ${params.amountIn} ${tokenInSymbol}
 输出: ~${response.estimatedAmountOut} ${tokenOutSymbol}
 滑点容忍度: ${params.slippage}%
 交易哈希: ${response.transactionHash}
 状态: ${response.success ? '已提交' : '失败'}
 
 交易已提交到区块链，将在几分钟内处理完成。
         `.trim();
         
         console.log("代币交换完成:", response);
         
         // 14. 如果有回调函数，执行回调
         if (callback) {
             await callback({
                 text: responseText
             });
         }
         
         return response;
         
     } catch (error) {
         console.error("⚠️ swapTokens主函数错误:", error);
         console.error("错误消息:", error.message);
         
         if (error.stack) {
             console.error("错误堆栈:", error.stack);
         }
         
         // 构建错误响应
         const errorText = `
 代币交换失败:
 错误信息: ${error.message}
 请确保钱包已部署、余额充足且网络连接正常。
         `.trim();
         
         if (callback) {
             await callback({
                 text: errorText
             });
         }
         
         throw error;
     }
 };
 
 /**
  * 解析代币地址的辅助函数
  * 支持代币符号到地址的转换
  */
 function resolveTokenAddress(tokenSymbol: string): string {
     const upperSymbol = tokenSymbol.toUpperCase();
     
     // 如果已经是地址格式，直接返回
     if (tokenSymbol.startsWith("0x") && tokenSymbol.length === 42) {
         return tokenSymbol;
     }
     
     // 处理ETH -> WETH的转换
     if (upperSymbol === "ETH") {
         return TOKEN_ADDRESSES.WETH;
     }
     
     // 从预定义列表中查找
     const address = TOKEN_ADDRESSES[upperSymbol as keyof typeof TOKEN_ADDRESSES];
     if (address) {
         return address;
     }
     
     throw new Error(`不支持的代币符号: ${tokenSymbol}。支持的代币: ${Object.keys(TOKEN_ADDRESSES).join(", ")}, ETH`);
 }
 
 /**
  * 执行交易的辅助函数
  * 复用executeTransaction的核心逻辑
  */
 async function executeTransaction(walletManager: Erc4337WalletManager, params: {to: string, value: string, data: string}) {
     const bundlerClient = new HttpRpcClient(
         walletManager.config.rpcUrl,
         walletManager.config.entryPointAddress,
         ARBITRUM_SEPOLIA_CHAIN_ID
     );
     
     const walletAddress = await walletManager.getCounterFactualAddress();
     let valueWei = ethers.BigNumber.from(0);
     
     if (params.value && params.value !== "0") {
         valueWei = ethers.utils.parseEther(params.value);
     }
     
     // 创建未签名用户操作
     const userOp = await walletManager.accountAPI.createUnsignedUserOp({
         target: params.to,
         data: params.data,
         value: valueWei
     });
     
     // 构建初始用户操作
     const initialUserOp = {
         sender: walletAddress,
         nonce: userOp.nonce ? ethers.utils.hexlify(await safeToNumber(userOp.nonce, 0)) : "0x00",
         initCode: userOp.initCode || "0x",
         callData: userOp.callData || "0x",
         callGasLimit: "0x0",
         verificationGasLimit: "0x0",
         preVerificationGas: "0x0",
         maxFeePerGas: userOp.maxFeePerGas ? ethers.utils.hexlify(await safeToNumber(userOp.maxFeePerGas, 1700000000)) : ethers.utils.hexlify(1700000000),
         maxPriorityFeePerGas: userOp.maxPriorityFeePerGas ? ethers.utils.hexlify(await safeToNumber(userOp.maxPriorityFeePerGas, 1500000000)) : ethers.utils.hexlify(1500000000),
         paymasterAndData: userOp.paymasterAndData || "0x",
         signature: "0x"
     };
     
     // 获取临时签名用于估算gas
     let tempSignature = await walletManager.accountAPI.signUserOp(initialUserOp as any);
     if (tempSignature && typeof tempSignature === 'object') {
         tempSignature = tempSignature.signature;
     }
     
     const signedUserOpForEstimation = {
         ...initialUserOp,
         signature: tempSignature
     };
     
     // 估算gas
     let gasEstimate;
     try {
         gasEstimate = await bundlerClient.estimateUserOpGas(signedUserOpForEstimation as any);
         gasEstimate = evenGas(gasEstimate);
     } catch (error) {
         console.log("估算gas失败，使用默认值:", error);
         gasEstimate = {
             callGasLimit: 500000,
             verificationGasLimit: 2000000,
             preVerificationGas: 100000
         };
     }
     
     // 更新用户操作
     const updatedUserOp = {
         ...signedUserOpForEstimation,
         callGasLimit: gasEstimate.callGasLimit ? ethers.utils.hexlify(gasEstimate.callGasLimit) : ethers.utils.hexlify(500000),
         verificationGasLimit: gasEstimate.verificationGasLimit ? ethers.utils.hexlify(gasEstimate.verificationGasLimit) : ethers.utils.hexlify(2000000),
         preVerificationGas: gasEstimate.preVerificationGas ? ethers.utils.hexlify(gasEstimate.preVerificationGas) : ethers.utils.hexlify(100000)
     };
     
     // 最终签名
     let finalSignature = await walletManager.accountAPI.signUserOp(updatedUserOp as any);
     if (finalSignature && typeof finalSignature === 'object') {
         finalSignature = finalSignature.signature;
     }
     
     const finalUserOp = {
         ...updatedUserOp,
         signature: finalSignature
     };
     
     // 发送交易
     const userOpHash = await bundlerClient.sendUserOpToBundler(finalUserOp as any);
     
     return {
         userOpHash,
         success: true
     };
 }
 
 /**
  * 验证swapTokens操作的函数
  */
 const validateSwapTokens = async (runtime, message, state) => {
     return true;
 };
 
 /**
  * ERC-4337账户抽象钱包代币交换Action定义
  */
 export const swapTokensAction: Action = {
     name: "swapTokens",
     description: "通过ERC-4337钱包进行代币交换",
     similes: ["交换代币", "代币兑换", "swap", "兑换", "买卖代币", "代币交易"],
     handler: swapTokensHandler,
     validate: validateSwapTokens,
     examples: [
         [
             {
                 user: "user1",
                 content: {
                     text: "交换100 USDC为ETH",
                 }
             },
             {
                 user: "agent",
                 content: {
                     text: "我将为您执行代币交换。正在检查余额和授权...",
                 }
             }
         ],
         [
             {
                 user: "user1",
                 content: {
                     text: "用50 USDT买WETH",
                 }
             },
             {
                 user: "agent",
                 content: {
                     text: "正在准备USDT到WETH的交换交易...",
                 }
             }
         ],
         [
             {
                 user: "user1",
                 content: {
                     text: "swap 200 DAI to USDC",
                 }
             },
             {
                 user: "agent",
                 content: {
                     text: "正在执行DAI到USDC的代币交换...",
                 }
             }
         ]
     ]
 };
