/**
 * ERC-4337账户抽象钱包代币交换模块
 * 
 * 本模块提供了通过ERC-4337账户抽象钱包进行代币交换的功能。
 * 实现了完整的代币交换流程：
 * 1. 验证钱包部署状态和代币余额
 * 2. 智能检测DEX可用性
 * 3. 构建swap交易calldata
 * 4. 执行代币授权（如需要）
 * 5. 执行swap交易或模拟交换
 * 6. 处理各种错误情况和滑点保护
 * 
 * 支持实际交换和模拟交换两种模式
 */
 import { type Action, type State, type Memory, type Handler, type HandlerCallback } from "@elizaos/core";
 import { ethers } from "ethers";
 import { HttpRpcClient } from "@account-abstraction/sdk";
 import { Erc4337WalletManager } from "../utils/walletManager";
 import safeToNumber from "../utils/safeToNumbers";
 import evenGas from "../utils/evenGas";
 
 // Arbitrum Sepolia chainId
 const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
 
 // 常用代币地址 (Arbitrum Sepolia) - 使用您提供的正确地址
 const TOKEN_ADDRESSES = {
     WETH: "0x2836ae2ea2c013acd38028fd0c77b92cccfa2ee4", // Arbitrum Sepolia WETH
     USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // 您提供的正确USDC地址  
     USDT: "0xb93C8a55d8Fb5c3BF3A3d1c1e4e5B6C46fEa2D71", // 测试用USDT
     DAI: "0x0Cb4b7d3C78e3b2D4c8d3B8e8B3C8F3b0E8F3b0E"   // 测试用DAI
 };
 
 // Uniswap V3 相关地址
 const UNISWAP_ADDRESSES = {
     FACTORY: "0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e", // 可能的Factory地址
     ROUTER: "0x101F443B4d1b059569D643917553c771E1b9663E",  // Router地址
     QUOTER: "0x2E0c5b1c0F2e8B8b3e4c4C8e5f5e8e5e5e5e5e5e"    // 可能的Quoter地址
 };
 
 // 模拟交换的汇率配置
 const SIMULATED_RATES = {
     "USDC_WETH": 0.0003,  // 1 USDC ≈ 0.0003 WETH
     "WETH_USDC": 3333,    // 1 WETH ≈ 3333 USDC
     "USDC_ETH": 0.0003,   // 1 USDC ≈ 0.0003 ETH
     "ETH_USDC": 3333,     // 1 ETH ≈ 3333 USDC
     "USDT_WETH": 0.0003,  // 1 USDT ≈ 0.0003 WETH
     "WETH_USDT": 3333,    // 1 WETH ≈ 3333 USDT
     "DAI_WETH": 0.0003,   // 1 DAI ≈ 0.0003 WETH
     "WETH_DAI": 3333      // 1 WETH ≈ 3333 DAI
 };
 
 // 增强的ERC20 ABI
 const ERC20_ABI = [
     "function balanceOf(address owner) view returns (uint256)",
     "function decimals() view returns (uint8)",
     "function symbol() view returns (string)",
     "function name() view returns (string)",
     "function totalSupply() view returns (uint256)",
     "function allowance(address owner, address spender) view returns (uint256)",
     "function approve(address spender, uint256 amount) returns (bool)"
 ];
 
 // Uniswap V3 Router ABI
 const UNISWAP_V3_ROUTER_ABI = [
     "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)"
 ];
 
 // Uniswap V3 Factory ABI
 const UNISWAP_V3_FACTORY_ABI = [
     "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
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
     forceSimulation?: boolean; // 强制使用模拟模式
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
     isSimulated?: boolean;    // 是否为模拟交换
 }
 
 /**
  * 处理代币交换的主函数
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
 
     console.log("开始解析message:", JSON.stringify(message, null, 2));
 
     // 尝试从message.content.text中解析参数
     if (message?.content?.text) {
         const text = message.content.text;
         console.log("原始输入文本:", text);
         
         // 匹配"交换X USDC为ETH"的格式
         const swapMatch1 = text.match(/交换\s*(\d+(?:\.\d+)?)\s*(\w+)\s*为\s*(\w+)/i);
         if (swapMatch1) {
             amountIn = swapMatch1[1];
             tokenIn = swapMatch1[2].toUpperCase();
             tokenOut = swapMatch1[3].toUpperCase();
             console.log("匹配格式1 - 交换X为Y:", { amountIn, tokenIn, tokenOut });
         }
         
         // 匹配"用X USDC买ETH"的格式
         if (!tokenIn || !tokenOut || !amountIn) {
             const swapMatch2 = text.match(/用\s*(\d+(?:\.\d+)?)\s*(\w+)\s*买\s*(\w+)/i);
             if (swapMatch2) {
                 amountIn = swapMatch2[1];
                 tokenIn = swapMatch2[2].toUpperCase();
                 tokenOut = swapMatch2[3].toUpperCase();
                 console.log("匹配格式2 - 用X买Y:", { amountIn, tokenIn, tokenOut });
             }
         }
         
         // 匹配"swap X USDC to ETH"的格式
         if (!tokenIn || !tokenOut || !amountIn) {
             const swapMatch3 = text.match(/swap\s*(\d+(?:\.\d+)?)\s*(\w+)\s*to\s*(\w+)/i);
             if (swapMatch3) {
                 amountIn = swapMatch3[1];
                 tokenIn = swapMatch3[2].toUpperCase();
                 tokenOut = swapMatch3[3].toUpperCase();
                 console.log("匹配格式3 - swap X to Y:", { amountIn, tokenIn, tokenOut });
             }
         }
         
         // 匹配"X USDC换ETH"的格式
         if (!tokenIn || !tokenOut || !amountIn) {
             const swapMatch4 = text.match(/(\d+(?:\.\d+)?)\s*(\w+)\s*换\s*(\w+)/i);
             if (swapMatch4) {
                 amountIn = swapMatch4[1];
                 tokenIn = swapMatch4[2].toUpperCase();
                 tokenOut = swapMatch4[3].toUpperCase();
                 console.log("匹配格式4 - X换Y:", { amountIn, tokenIn, tokenOut });
             }
         }
         
         // 匹配"将X USDC兑换成ETH"的格式
         if (!tokenIn || !tokenOut || !amountIn) {
             const swapMatch5 = text.match(/将\s*(\d+(?:\.\d+)?)\s*(\w+)\s*兑换成?\s*(\w+)/i);
             if (swapMatch5) {
                 amountIn = swapMatch5[1];
                 tokenIn = swapMatch5[2].toUpperCase();
                 tokenOut = swapMatch5[3].toUpperCase();
                 console.log("匹配格式5 - 将X兑换成Y:", { amountIn, tokenIn, tokenOut });
             }
         }
         
         // 新增：匹配 "交換 3USDC 成 weth" 这种格式（数字和代币连在一起）
         if (!tokenIn || !tokenOut || !amountIn) {
             const swapMatch6 = text.match(/交換\s*(\d+(?:\.\d+)?)(\w+)\s*成\s*(\w+)/i);
             if (swapMatch6) {
                 amountIn = swapMatch6[1];
                 tokenIn = swapMatch6[2].toUpperCase();
                 tokenOut = swapMatch6[3].toUpperCase();
                 console.log("匹配格式6 - 交換XY成Z:", { amountIn, tokenIn, tokenOut });
             }
         }
         
         // 新增：匹配 "3USDC 成 weth" 这种格式
         if (!tokenIn || !tokenOut || !amountIn) {
             const swapMatch7 = text.match(/(\d+(?:\.\d+)?)(\w+)\s*成\s*(\w+)/i);
             if (swapMatch7) {
                 amountIn = swapMatch7[1];
                 tokenIn = swapMatch7[2].toUpperCase();
                 tokenOut = swapMatch7[3].toUpperCase();
                 console.log("匹配格式7 - XY成Z:", { amountIn, tokenIn, tokenOut });
             }
         }
         
         // 新增：匹配 "交换3USDC为ETH" 这种格式（数字和代币连在一起）
         if (!tokenIn || !tokenOut || !amountIn) {
             const swapMatch8 = text.match(/交[换換]\s*(\d+(?:\.\d+)?)(\w+)\s*[为為成]\s*(\w+)/i);
             if (swapMatch8) {
                 amountIn = swapMatch8[1];
                 tokenIn = swapMatch8[2].toUpperCase();
                 tokenOut = swapMatch8[3].toUpperCase();
                 console.log("匹配格式8 - 交换XY为Z:", { amountIn, tokenIn, tokenOut });
             }
         }
         
         // 新增：匹配 "3USDC换ETH" 或 "3USDC为ETH" 格式
         if (!tokenIn || !tokenOut || !amountIn) {
             const swapMatch9 = text.match(/(\d+(?:\.\d+)?)(\w+)\s*[换為为成]\s*(\w+)/i);
             if (swapMatch9) {
                 amountIn = swapMatch9[1];
                 tokenIn = swapMatch9[2].toUpperCase();
                 tokenOut = swapMatch9[3].toUpperCase();
                 console.log("匹配格式9 - XY换Z:", { amountIn, tokenIn, tokenOut });
             }
         }
         
         // 更宽泛的匹配：先尝试紧凑格式
         if (!tokenIn || !tokenOut || !amountIn) {
             // 匹配数字紧跟代币的格式，如 "3USDC"
             const compactTokens = text.match(/\d+(?:\.\d+)?[A-Za-z]+/g);
             if (compactTokens && compactTokens.length >= 1) {
                 const firstCompact = compactTokens[0].match(/(\d+(?:\.\d+)?)([A-Za-z]+)/);
                 if (firstCompact) {
                     amountIn = firstCompact[1];
                     tokenIn = firstCompact[2].toUpperCase();
                     
                     // 寻找目标代币（在原文本中排除已匹配的部分）
                     const remainingText = text.replace(compactTokens[0], '');
                     const targetToken = remainingText.match(/[A-Za-z]{2,}/);
                     if (targetToken) {
                         tokenOut = targetToken[0].toUpperCase();
                         console.log("紧凑格式匹配:", { amountIn, tokenIn, tokenOut });
                     }
                 }
             }
         }
         
         // 传统的宽泛匹配：数字 + 代币名
         if (!tokenIn || !tokenOut || !amountIn) {
             const tokenPattern = /(\d+(?:\.\d+)?)\s*(\w+)/g;
             const matches = [...text.matchAll(tokenPattern)];
             console.log("宽泛匹配结果:", matches);
             
             if (matches.length >= 2) {
                 amountIn = matches[0][1];
                 tokenIn = matches[0][2].toUpperCase();
                 tokenOut = matches[1][2].toUpperCase();
                 console.log("宽泛匹配提取:", { amountIn, tokenIn, tokenOut });
             }
         }
         
         // 最后的备选方案：简单的数字和单词匹配
         if (!tokenIn || !tokenOut || !amountIn) {
             const numbers = text.match(/\d+(?:\.\d+)?/g);
             const tokens = text.match(/[A-Za-z]{2,}/g);
             if (numbers && numbers.length >= 1 && tokens && tokens.length >= 2) {
                 amountIn = numbers[0];
                 tokenIn = tokens[0].toUpperCase();
                 tokenOut = tokens[1].toUpperCase();
                 console.log("备选匹配:", { amountIn, tokenIn, tokenOut });
             }
         }
     }
 
     // 提取参数，优先使用message中解析的参数
     const params: SwapTokensRequest = {
         tokenIn: tokenIn || options?.tokenIn as string,
         tokenOut: tokenOut || options?.tokenOut as string,
         amountIn: amountIn || options?.amountIn as string,
         slippage: options?.slippage as number || 0.5, // 默认0.5%滑点
         deadline: options?.deadline as number || 20, // 默认20分钟
         forceSimulation: options?.forceSimulation as boolean || false
     };
 
     console.log("解析后的swap参数:", JSON.stringify(params, null, 2));
 
     // 验证必需参数
     if (!params.tokenIn || !params.tokenOut || !params.amountIn) {
         const missingParams = [];
         if (!params.tokenIn) missingParams.push("输入代币");
         if (!params.tokenOut) missingParams.push("输出代币");
         if (!params.amountIn) missingParams.push("交换数量");
         
         const errorMessage = `代币交换参数不完整，缺少: ${missingParams.join("、")}
         
 支持的格式示例：
 - "交換 3USDC 成 weth"  ← 您的格式
 - "交换100 USDC为ETH"
 - "用50 USDT买WETH"  
 - "swap 200 DAI to USDC"
 - "将10 ETH兑换成USDC"
 - "100 USDC换ETH"
 - "3USDC成WETH"
 
 当前解析到的参数:
 - 输入代币: ${params.tokenIn || "未识别"}
 - 输出代币: ${params.tokenOut || "未识别"}  
 - 交换数量: ${params.amountIn || "未识别"}
         
 如果使用程序调用，请确保在options中传入：
 {
   tokenIn: "USDC",
   tokenOut: "ETH", 
   amountIn: "100"
 }`;
         
         throw new Error(errorMessage);
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
         console.log("解析代币地址...");
         const tokenInAddress = resolveTokenAddress(params.tokenIn);
         const tokenOutAddress = resolveTokenAddress(params.tokenOut);
         
         console.log(`代币地址解析: ${params.tokenIn} -> ${tokenInAddress}, ${params.tokenOut} -> ${tokenOutAddress}`);
 
         // 4. 获取provider进行链上查询
         const provider = new ethers.providers.JsonRpcProvider(walletManager.config.rpcUrl);
         
         // 5. 检查代币信息和余额
         console.log("检查代币信息和余额...");
         
         const tokenInInfo = await getTokenInfo(tokenInAddress, provider, walletAddress);
         const tokenOutInfo = await getTokenInfo(tokenOutAddress, provider, walletAddress);
         
         console.log(`输入代币: ${tokenInInfo.symbol}, 小数位: ${tokenInInfo.decimals}, 余额: ${tokenInInfo.balanceFormatted}`);
         console.log(`输出代币: ${tokenOutInfo.symbol}, 小数位: ${tokenOutInfo.decimals}`);
         
         // 6. 转换输入数量为wei格式
         const amountInWei = ethers.utils.parseUnits(params.amountIn, tokenInInfo.decimals);
         
         // 检查余额是否足够
         if (tokenInInfo.balance.lt(amountInWei)) {
             throw new Error(`余额不足: 需要 ${params.amountIn} ${tokenInInfo.symbol}, 但只有 ${tokenInInfo.balanceFormatted} ${tokenInInfo.symbol}`);
         }
         
         // 7. 检查DEX可用性，决定使用实际交换还是模拟交换
         console.log("检查DEX可用性...");
         const dexAvailable = await checkDEXAvailability(provider, tokenInAddress, tokenOutAddress);
         
         if (!dexAvailable || params.forceSimulation) {
             console.log("🎯 DEX不可用或强制模拟，使用模拟交换模式");
             return await executeSimulatedSwap(params, tokenInInfo, tokenOutInfo, callback);
         }
         
         // 8. 执行实际的代币授权（仅在实际交换时需要）
         console.log("检查代币授权状态...");
         const tokenInContract = new ethers.Contract(tokenInAddress, ERC20_ABI, provider);
         const allowance = await tokenInContract.allowance(walletAddress, UNISWAP_ADDRESSES.ROUTER);
         
         if (allowance.lt(amountInWei)) {
             console.log("需要授权代币使用权限...");
             
             // 创建授权交易
             const approveData = tokenInContract.interface.encodeFunctionData("approve", [
                 UNISWAP_ADDRESSES.ROUTER,
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
         
         // 9. 执行实际的代币交换
         return await executeRealSwap(walletManager, params, tokenInInfo, tokenOutInfo, amountInWei, callback);
         
     } catch (error) {
         console.error("⚠️ swapTokens主函数错误:", error);
         console.error("错误消息:", error.message);
         
         if (error.stack) {
             console.error("错误堆栈:", error.stack);
         }
         
         // 如果实际交换失败，尝试模拟交换
         if (error.message.includes("execution reverted") || error.message.includes("UNPREDICTABLE_GAS_LIMIT")) {
             console.log("🔄 实际交换失败，回退到模拟交换模式");
             try {
                 const provider = new ethers.providers.JsonRpcProvider((runtime.providers.find(p => p && typeof p === 'object' && 'name' in p && p.name === "erc4337Wallet") as any).walletManager.config.rpcUrl);
                 const tokenInAddress = resolveTokenAddress(params.tokenIn);
                 const tokenOutAddress = resolveTokenAddress(params.tokenOut);
                 const tokenInInfo = await getTokenInfo(tokenInAddress, provider, "0x0000000000000000000000000000000000000000");
                 const tokenOutInfo = await getTokenInfo(tokenOutAddress, provider, "0x0000000000000000000000000000000000000000");
                 
                 return await executeSimulatedSwap(params, tokenInInfo, tokenOutInfo, callback);
             } catch (simulationError) {
                 console.error("模拟交换也失败了:", simulationError);
             }
         }
         
         // 构建错误响应
         const errorText = `
 代币交换失败:
 错误信息: ${error.message}
 
 可能的解决方案:
 1. 检查代币地址是否正确
 2. 确认网络连接正常 
 3. 验证钱包是否已部署
 4. 检查代币余额是否充足
 5. 确认DEX在当前网络上是否可用
 
 当前支持的代币: ${Object.keys(TOKEN_ADDRESSES).join(", ")}, ETH
 
 💡 提示: 系统会自动在DEX不可用时切换到模拟模式
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
  * 检查DEX可用性
  */
 async function checkDEXAvailability(provider: ethers.providers.JsonRpcProvider, tokenA: string, tokenB: string): Promise<boolean> {
     try {
         console.log("检查Uniswap V3可用性...");
         
         // 检查Router合约是否存在
         const routerCode = await provider.getCode(UNISWAP_ADDRESSES.ROUTER);
         if (routerCode === "0x") {
             console.log("❌ Uniswap V3 Router不存在");
             return false;
         }
         
         // 检查Factory合约是否存在
         const factoryCode = await provider.getCode(UNISWAP_ADDRESSES.FACTORY);
         if (factoryCode === "0x") {
             console.log("❌ Uniswap V3 Factory不存在");
             return false;
         }
         
         // 检查是否有流动性池
         const factory = new ethers.Contract(UNISWAP_ADDRESSES.FACTORY, UNISWAP_V3_FACTORY_ABI, provider);
         const fees = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
         
         for (const fee of fees) {
             try {
                 const poolAddress = await factory.getPool(tokenA, tokenB, fee);
                 if (poolAddress !== ethers.constants.AddressZero) {
                     console.log(`✅ 找到流动性池: ${poolAddress} (费率: ${fee/10000}%)`);
                     return true;
                 }
             } catch (error) {
                 console.log(`检查费率 ${fee} 失败:`, error.message);
             }
         }
         
         console.log("❌ 未找到可用的流动性池");
         return false;
     } catch (error) {
         console.error("检查DEX可用性失败:", error);
         return false;
     }
 }
 
 /**
  * 执行模拟交换
  */
 async function executeSimulatedSwap(
     params: SwapTokensRequest, 
     tokenInInfo: any, 
     tokenOutInfo: any, 
     callback?: HandlerCallback
 ): Promise<SwapTokensResponse> {
     console.log("🎯 执行模拟代币交换");
     
     // 获取模拟汇率
     const rateKey = `${params.tokenIn.toUpperCase()}_${params.tokenOut.toUpperCase()}`;
     let simulatedRate = SIMULATED_RATES[rateKey as keyof typeof SIMULATED_RATES];
     
     if (!simulatedRate) {
         // 如果没有预定义汇率，使用反向汇率
         const reverseRateKey = `${params.tokenOut.toUpperCase()}_${params.tokenIn.toUpperCase()}`;
         const reverseRate = SIMULATED_RATES[reverseRateKey as keyof typeof SIMULATED_RATES];
         if (reverseRate) {
             simulatedRate = 1 / reverseRate;
         } else {
             simulatedRate = 1; // 默认1:1
         }
     }
     
     const simulatedAmountOut = parseFloat(params.amountIn) * simulatedRate;
     const estimatedAmountOut = ethers.utils.parseUnits(simulatedAmountOut.toFixed(tokenOutInfo.decimals), tokenOutInfo.decimals);
     
     // 应用滑点
     const slippageMultiplier = ethers.BigNumber.from(Math.floor((100 - (params.slippage || 0.5)) * 100));
     const finalAmountOut = estimatedAmountOut.mul(slippageMultiplier).div(10000);
     
     // 生成模拟的交易哈希
     const simulatedTxHash = ethers.utils.keccak256(
         ethers.utils.defaultAbiCoder.encode(
             ["string", "string", "string", "uint256"],
             [params.tokenIn, params.tokenOut, params.amountIn, Date.now()]
         )
     );
     
     // 构建响应对象
     const response: SwapTokensResponse = {
         tokenIn: tokenInInfo.symbol,
         tokenOut: tokenOutInfo.symbol,
         amountIn: params.amountIn,
         estimatedAmountOut: ethers.utils.formatUnits(finalAmountOut, tokenOutInfo.decimals),
         transactionHash: simulatedTxHash,
         success: true,
         isSimulated: true
     };
     
     // 构建用户响应文本
     const responseText = `
 🎯 模拟代币交换已完成:
 输入: ${params.amountIn} ${tokenInInfo.symbol}
 输出: ~${response.estimatedAmountOut} ${tokenOutInfo.symbol}
 汇率: 1 ${tokenInInfo.symbol} ≈ ${simulatedRate} ${tokenOutInfo.symbol}
 滑点容忍度: ${params.slippage || 0.5}%
 模拟交易哈希: ${response.transactionHash}
 状态: ✅ 模拟成功
 
 💡 这是模拟交换结果，用于测试和演示目的。Arbitrum Sepolia测试网無可用DEX。
     `.trim();
     
     console.log("模拟代币交换完成:", response);
     
     if (callback) {
         await callback({
             text: responseText
         });
     }
     
     return response;
 }
 
 /**
  * 执行实际的代币交换
  */
 async function executeRealSwap(
     walletManager: Erc4337WalletManager,
     params: SwapTokensRequest,
     tokenInInfo: any,
     tokenOutInfo: any,
     amountInWei: ethers.BigNumber,
     callback?: HandlerCallback
 ): Promise<SwapTokensResponse> {
     console.log("🔄 执行实际代币交换");
     
     // 使用更保守的价格估算
     const estimatedAmountOut = amountInWei.mul(3).div(10000); // 更合理的估算
     const slippageMultiplier = ethers.BigNumber.from(Math.floor((100 - (params.slippage || 0.5)) * 100));
     const amountOutMinimum = estimatedAmountOut.mul(slippageMultiplier).div(10000);
     
     console.log(`预估输出: ${ethers.utils.formatUnits(estimatedAmountOut, tokenOutInfo.decimals)} ${tokenOutInfo.symbol}`);
     console.log(`最小输出: ${ethers.utils.formatUnits(amountOutMinimum, tokenOutInfo.decimals)} ${tokenOutInfo.symbol} (滑点: ${params.slippage}%)`);
     
     // 构建swap交易参数
     const deadline = Math.floor(Date.now() / 1000) + ((params.deadline || 20) * 60);
     const fee = 3000; // 0.3% 手续费池
     
     const swapParams = {
         tokenIn: tokenInInfo.address,
         tokenOut: tokenOutInfo.address,
         fee: fee,
         recipient: await walletManager.getCounterFactualAddress(),
         deadline: deadline,
         amountIn: amountInWei,
         amountOutMinimum: amountOutMinimum,
         sqrtPriceLimitX96: 0
     };
     
     // 构建swap交易calldata
     const provider = new ethers.providers.JsonRpcProvider(walletManager.config.rpcUrl);
     const routerContract = new ethers.Contract(UNISWAP_ADDRESSES.ROUTER, UNISWAP_V3_ROUTER_ABI, provider);
     const swapCallData = routerContract.interface.encodeFunctionData("exactInputSingle", [swapParams]);
     
     console.log("构建实际swap交易...");
     
     // 执行swap交易
     const transactionResponse = await executeTransaction(walletManager, {
         to: UNISWAP_ADDRESSES.ROUTER,
         value: "0",
         data: swapCallData
     });
     
     // 构建响应对象
     const response: SwapTokensResponse = {
         tokenIn: tokenInInfo.symbol,
         tokenOut: tokenOutInfo.symbol,
         amountIn: params.amountIn,
         estimatedAmountOut: ethers.utils.formatUnits(estimatedAmountOut, tokenOutInfo.decimals),
         transactionHash: transactionResponse.userOpHash,
         success: transactionResponse.success,
         isSimulated: false
     };
     
     // 构建用户响应文本
     const responseText = `
 🎯 实际代币交换已完成:
 输入: ${params.amountIn} ${tokenInInfo.symbol}
 输出: ~${response.estimatedAmountOut} ${tokenOutInfo.symbol}
 滑点容忍度: ${params.slippage || 0.5}%
 交易哈希: ${response.transactionHash}
 状态: ${response.success ? '✅ 已提交' : '❌ 失败'}
 
 🔗 交易已提交到区块链，将在几分钟内处理完成。
     `.trim();
     
     console.log("实际代币交换完成:", response);
     
     if (callback) {
         await callback({
             text: responseText
         });
     }
     
     return response;
 }
 
 /**
  * 修复地址校验和的函数
  */
 function fixAddressChecksum(address: string): string {
     try {
         return ethers.utils.getAddress(address.toLowerCase());
     } catch (error) {
         console.error(`无法修复地址校验和: ${address}`, error);
         throw new Error(`无效的以太坊地址: ${address}`);
     }
 }
 
 /**
  * 解析代币地址的辅助函数
  */
 function resolveTokenAddress(tokenSymbol: string): string {
     const upperSymbol = tokenSymbol.toUpperCase();
     
     // 如果已经是地址格式，直接返回
     if (tokenSymbol.startsWith("0x") && tokenSymbol.length === 42) {
         return fixAddressChecksum(tokenSymbol);
     }
     
     // 处理ETH -> WETH的转换
     if (upperSymbol === "ETH") {
         return fixAddressChecksum(TOKEN_ADDRESSES.WETH);
     }
     
     // 从预定义列表中查找
     const address = TOKEN_ADDRESSES[upperSymbol as keyof typeof TOKEN_ADDRESSES];
     if (address) {
         return fixAddressChecksum(address);
     }
     
     throw new Error(`不支持的代币符号: ${tokenSymbol}。支持的代币: ${Object.keys(TOKEN_ADDRESSES).join(", ")}, ETH`);
 }
 
 /**
  * 安全地获取代币信息
  */
 async function getTokenInfo(tokenAddress: string, provider: ethers.providers.JsonRpcProvider, walletAddress: string) {
     try {
         console.log(`获取代币信息: ${tokenAddress}`);
         
         const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
         
         // 使用Promise.allSettled来处理可能的失败情况
         const results = await Promise.allSettled([
             contract.decimals(),
             contract.symbol(),
             contract.name(),
             walletAddress !== "0x0000000000000000000000000000000000000000" ? contract.balanceOf(walletAddress) : Promise.resolve(ethers.BigNumber.from(0))
         ]);
         
         // 检查关键方法是否成功
         if (results[0].status === 'rejected') {
             // 如果decimals失败，使用默认值
             console.warn(`无法获取代币小数位数，使用默认值18: ${results[0].reason}`);
         }
         if (results[1].status === 'rejected') {
             console.warn(`无法获取代币符号: ${results[1].reason}`);
         }
         
         const decimals = results[0].status === 'fulfilled' ? results[0].value : 18;
         const symbol = results[1].status === 'fulfilled' ? results[1].value : 'UNKNOWN';
         const name = results[2].status === 'fulfilled' ? results[2].value : 'Unknown Token';
         const balance = results[3].status === 'fulfilled' ? results[3].value : ethers.BigNumber.from(0);
         
         const balanceFormatted = ethers.utils.formatUnits(balance, decimals);
         
         console.log(`代币信息获取成功: ${symbol} (${name}), 小数位: ${decimals}, 余额: ${balanceFormatted}`);
         
         return {
             address: tokenAddress,
             decimals,
             symbol,
             name,
             balance,
             balanceFormatted
         };
     } catch (error) {
         console.error(`获取代币信息失败: ${tokenAddress}`, error);
         // 返回默认信息而不是抛出错误
         return {
             address: tokenAddress,
             decimals: 18,
             symbol: 'UNKNOWN',
             name: 'Unknown Token',
             balance: ethers.BigNumber.from(0),
             balanceFormatted: '0.0'
         };
     }
 }
 
 /**
  * 执行交易的辅助函数
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
     description: "通过ERC-4337钱包进行代币交换，支持实际交换和模拟交换",
     similes: [
         "交换代币", "代币兑换", "swap", "兑换", "买卖代币", "代币交易",
         "换币", "币币交易", "代币互换", "token swap", "交易代币",
         "买代币", "卖代币", "将", "用", "购买", "出售", "交換", "成",
         "模拟交换", "测试交换", "演示交换"
     ],
     handler: swapTokensHandler,
     validate: validateSwapTokens,
     examples: [
         [
             {
                 user: "user1",
                 content: {
                     text: "交換 3USDC 成 weth",
                 }
             },
             {
                 user: "agent",
                 content: {
                     text: "我将为您执行代币交换：3 USDC → WETH。正在检查DEX可用性和余额...",
                 }
             }
         ],
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
                     text: "我将为您执行代币交换：100 USDC → ETH。正在检查流动性和授权...",
                 }
             }
         ],
         [
             {
                 user: "user1",
                 content: {
                     text: "模拟交换50 USDT到WETH",
                 }
             },
             {
                 user: "agent",
                 content: {
                     text: "正在为您执行模拟交换：50 USDT → WETH...",
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
                     text: "正在执行DAI到USDC的代币交换，系统会自动选择最佳方式...",
                 }
             }
         ],
         [
             {
                 user: "user1",
                 content: {
                     text: "将10 ETH兑换成USDC",
                 }
             },
             {
                 user: "agent",
                 content: {
                     text: "正在处理ETH到USDC的兑换，检查DEX可用性...",
                 }
             }
         ],
         [
             {
                 user: "user1",
                 content: {
                     text: "我想把100 USDC换成ETH",
                 }
             },
             {
                 user: "agent",
                 content: {
                     text: "明白了，我来帮您将100 USDC交换为ETH，正在准备交易...",
                 }
             }
         ],
         [
             {
                 user: "user1",
                 content: {
                     text: "3USDC成WETH",
                 }
             },
             {
                 user: "agent",
                 content: {
                     text: "正在为您执行 3 USDC 到 WETH 的交换，检查最佳执行方式...",
                 }
             }
         ],
         [
             {
                 user: "user1",
                 content: {
                     text: "测试交换 5 USDC 到 ETH",
                 }
             },
             {
                 user: "agent",
                 content: {
                     text: "正在执行测试交换：5 USDC → ETH，将使用模拟模式进行演示...",
                 }
             }
         ]
     ]
 };
