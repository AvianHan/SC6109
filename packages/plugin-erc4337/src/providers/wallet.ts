import { type Provider, ProviderCategory, type ProviderDefinition } from "../types";
import { type IAgentRuntime, type Memory, type State } from "@elizaos/core";
import { Erc4337WalletManager, initErc4337WalletManager } from "../utils/walletManager";
import { ethers } from "ethers";
import { saveWalletInfoToFile, readWalletInfoFromFile, type WalletInfo } from "../utils/walletStore";

// 确保全局变量能够被正确保存
if (typeof global !== 'undefined' && !(global as any).erc4337_initialized) {
    (global as any).erc4337_initialized = true;
    console.log("初始化全局钱包信息存储对象");
}

// 钱包信息存储键
const WALLET_INFO_KEY = "erc4337_wallet_info";

// Erc4337钱包提供者实例接口
interface Erc4337WalletProviderInstance {
    name: string;
    walletManager: Erc4337WalletManager;
}

// 保存钱包信息到存储
async function saveWalletInfo(walletAddress: string, ownerAddress: string) {
    try {
        const walletInfo: WalletInfo = { 
            walletAddress, 
            ownerAddress, 
            timestamp: Date.now() 
        };
        
        // 在浏览器环境使用localStorage
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(WALLET_INFO_KEY, JSON.stringify(walletInfo));
            console.log(`钱包信息已保存到localStorage: ${walletAddress}`);
        } else {
            // 保存到全局变量
            (global as any)[WALLET_INFO_KEY] = walletInfo;
            console.log(`钱包信息已保存到全局变量: ${walletAddress}`);
        }
        
        // 尝试保存到文件
        const fileSaveResult = await saveWalletInfoToFile(walletInfo);
        if (fileSaveResult) {
            console.log(`钱包信息已成功保存到文件`);
        }
        
        console.log(`已保存钱包信息: ${walletAddress}`);
    } catch (error) {
        console.error("保存钱包信息失败:", error);
    }
}

// 从存储获取钱包信息
async function getStoredWalletInfo(): Promise<{ walletAddress: string, ownerAddress: string } | null> {
    try {
        console.log("开始获取存储的钱包信息...");
        
        // 1. 优先从全局变量获取(内存中)
        const globalInfo = (global as any)[WALLET_INFO_KEY];
        if (globalInfo) {
            console.log(`从全局变量获取到钱包信息: ${globalInfo.walletAddress}`);
            return globalInfo;
        } else {
            console.log("全局变量中没有钱包信息");
        }
        
        // 2. 从localStorage获取
        if (typeof localStorage !== 'undefined') {
            const walletInfoStr = localStorage.getItem(WALLET_INFO_KEY);
            if (walletInfoStr) {
                const walletInfo = JSON.parse(walletInfoStr);
                console.log(`从localStorage获取到钱包信息: ${walletInfo.walletAddress}`);
                return walletInfo;
            }
        }
        
        // 3. 最后从文件获取
        const fileInfo = await readWalletInfoFromFile();
        if (fileInfo) {
            // 同步到全局变量
            (global as any)[WALLET_INFO_KEY] = fileInfo;
            console.log(`从文件获取到钱包信息并同步到全局变量: ${fileInfo.walletAddress}`);
            return fileInfo;
        }
        
        console.log("没有找到已保存的钱包信息");
        return null;
    } catch (error) {
        console.error("获取存储的钱包信息失败:", error);
        return null;
    }
}

/**
 * ERC-4337钱包提供者定义
 * 
 * 负责初始化ERC-4337钱包提供者实例，包括：
 * - 从运行时设置中获取必要的配置参数
 * - 创建钱包管理器实例
 * - 设置正确的网络参数（Arbitrum Sepolia）
 * 
 * 初始化完成后，返回一个可用于访问和管理ERC-4337账户抽象钱包的提供者实例。
 */
export const erc4337WalletProviderDefinition: ProviderDefinition = {
    name: "erc4337Wallet",
    category: ProviderCategory.WALLET,
    init: (runtime): any => {
        console.log("开始初始化erc4337WalletProvider...");
        
        // 由于runtime可能没有异步初始化，这里先创建实例结构
        // 实际的walletManager会在第一次请求时懒加载
        return {
            name: "erc4337Wallet",
            walletManager: null,  // 会在get方法中初始化
            _initialized: false,  // 标记是否已初始化
            _initPromise: null    // 保存初始化promise
        };
    }
};

/**
 * ERC-4337钱包提供者
 * 
 * 提供对ERC-4337钱包信息的访问功能，实现了Core包的Provider接口。
 * 此提供者可以：
 * - 查找已初始化的钱包提供者实例
 * - 获取钱包地址、所有者地址和部署状态
 * - 返回格式化的钱包信息
 * 
 * 主要用于在运行时查询钱包状态和基本信息。
 */
export const erc4337WalletProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
        console.log("erc4337WalletProvider get 开始");
        try {
            // 检查和打印所有provider
            console.log(`当前runtime中共有${runtime.providers.length}个providers`);
            runtime.providers.forEach((p, index) => {
                console.log(`Provider #${index}:`, p && typeof p === 'object' ? `名称:${(p as any).name || '未知'}` : '非对象类型');
            });
            
            // 查找已创建的provider实例
            const providerInstance = runtime.providers.find(
                p => p && typeof p === 'object' && 'name' in p && p.name === "erc4337Wallet"
            ) as any;
            
            // 如果没有找到实例，则先检查是否有已部署的钱包信息
            if (!providerInstance) {
                console.log("未找到erc4337Wallet提供者实例，检查是否有已部署的钱包...");
                
                // 获取存储的钱包信息
                const storedWalletInfo = await getStoredWalletInfo();
                
                // 如果有存储的信息，检查地址是否有效
                if (storedWalletInfo && ethers.utils.isAddress(storedWalletInfo.walletAddress)) {
                    console.log(`发现已部署的钱包: ${storedWalletInfo.walletAddress}，尝试使用它初始化...`);
                    
                    try {
                        // 创建钱包管理器
                        const walletManager = await initErc4337WalletManager(runtime);
                        
                        // 验证存储的地址与当前计算的地址是否匹配
                        const currentAddress = await walletManager.getCounterFactualAddress();
                        if (currentAddress.toLowerCase() === storedWalletInfo.walletAddress.toLowerCase()) {
                            console.log("存储的钱包地址与当前计算的地址匹配，使用现有钱包");
                        } else {
                            console.log(`存储的钱包地址(${storedWalletInfo.walletAddress})与当前计算的地址(${currentAddress})不匹配，使用当前钱包`);
                        }
                        
                        // 创建并添加provider实例到runtime
                        const newProviderInstance = {
                            name: "erc4337Wallet", 
                            walletManager,
                            _initialized: true,
                            get: erc4337WalletProvider.get
                        };
                        runtime.providers.push(newProviderInstance);
                        console.log("已创建并添加新的provider实例到runtime");
                        
                        return await getWalletInfo(walletManager, state);
                    } catch (error) {
                        console.error("使用已部署的钱包初始化失败:", error);
                        // 失败后回退到标准初始化
                    }
                }
                
                // 如果没有存储的信息或无法使用它，创建新的钱包管理器
                console.log("创建新的钱包管理器...");
                try {
                    const walletManager = await initErc4337WalletManager(runtime);
                    
                    // 创建并添加provider实例到runtime
                    const newProviderInstance = {
                        name: "erc4337Wallet", 
                        walletManager,
                        _initialized: true,
                        get: erc4337WalletProvider.get
                    };
                    runtime.providers.push(newProviderInstance);
                    console.log("已创建并添加新的provider实例到runtime");
                    
                    return await getWalletInfo(walletManager, state);
                } catch (error) {
                    console.error("无法创建钱包管理器:", error);
                    return null;
                }
            }
            
            // 检查是否需要初始化walletManager
            if (!providerInstance.walletManager && !providerInstance._initPromise) {
                console.log("provider实例存在，但walletManager未初始化，开始初始化...");
                
                // 先检查是否有已部署的钱包信息
                const storedWalletInfo = await getStoredWalletInfo();
                if (storedWalletInfo && ethers.utils.isAddress(storedWalletInfo.walletAddress)) {
                    console.log(`发现已部署的钱包: ${storedWalletInfo.walletAddress}，尝试使用它初始化...`);
                }
                
                // 创建初始化promise并保存
                providerInstance._initPromise = initErc4337WalletManager(runtime)
                    .then(async manager => {
                        // 如果有存储的信息，验证地址是否匹配
                        if (storedWalletInfo) {
                            const currentAddress = await manager.getCounterFactualAddress();
                            if (currentAddress.toLowerCase() === storedWalletInfo.walletAddress.toLowerCase()) {
                                console.log("存储的钱包地址与当前计算的地址匹配");
                            } else {
                                console.log(`存储的钱包地址(${storedWalletInfo.walletAddress})与当前计算的地址(${currentAddress})不匹配`);
                            }
                        }
                        
                        providerInstance.walletManager = manager;
                        providerInstance._initialized = true;
                        console.log("钱包管理器初始化成功");
                        return manager;
                    })
                    .catch(error => {
                        console.error("钱包管理器初始化失败:", error);
                        providerInstance._initPromise = null;
                        throw error;
                    });
            }
            
            // 如果已有初始化过程，等待其完成
            if (providerInstance._initPromise && !providerInstance._initialized) {
                console.log("等待钱包管理器初始化完成...");
                try {
                    const manager = await providerInstance._initPromise;
                    return await getWalletInfo(manager, state);
                } catch (error) {
                    console.error("钱包管理器初始化失败:", error);
                    return null;
                }
            }
            
            // 已经初始化完成，直接使用
            if (providerInstance.walletManager) {
                console.log("使用已初始化的钱包管理器");
                return await getWalletInfo(providerInstance.walletManager, state);
            }
            
            // 所有尝试都失败，返回null
            console.error("无法获取钱包管理器");
            return null;
        } catch (error) {
            console.error("获取ERC-4337钱包信息失败:", error);
            return null;
        }
    }
};

/**
 * 获取钱包信息，格式化为文本
 * @param walletManager 钱包管理器实例
 * @param state 可选的状态对象
 * @returns 格式化的钱包信息文本
 */
async function getWalletInfo(walletManager: Erc4337WalletManager, state?: State): Promise<string> {
    // 获取钱包地址
    const walletAddress = await walletManager.getCounterFactualAddress();
    
    // 检查钱包是否已部署
    const isDeployed = await walletManager.isDeployed();
    
    // 获取所有者地址
    const ownerAddress = await walletManager.getOwnerAddress();
    
    // 如果钱包已部署，保存信息以便下次使用
    if (isDeployed) {
        await saveWalletInfo(walletAddress, ownerAddress);
    }
    
    // 返回格式化的钱包信息
    return `ERC-4337钱包信息:\n地址: ${walletAddress}\n所有者: ${ownerAddress}\n状态: ${isDeployed ? '已部署' : '未部署'}`;
}