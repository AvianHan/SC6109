// 钱包存储工具
// 使用Node.js原生API进行文件读写操作，避免使用require('fs')

/**
 * 钱包信息接口
 */
export interface WalletInfo {
  walletAddress: string;
  ownerAddress: string;
  timestamp: number;
}

// 存储文件路径 - 使用当前用户的home目录
const WALLET_FILE_NAME = '.erc4337_wallet_info.json';
let WALLET_STORE_PATH = '';

// 初始化文件路径
async function initStorePath(): Promise<string> {
  if (WALLET_STORE_PATH) return WALLET_STORE_PATH;
  
  try {
    if (typeof process !== 'undefined') {
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const home = homedir();
      WALLET_STORE_PATH = join(home, WALLET_FILE_NAME);
      console.log(`初始化钱包存储文件路径: ${WALLET_STORE_PATH}`);
      return WALLET_STORE_PATH;
    }
    return '';
  } catch (error) {
    console.error('初始化存储路径失败:', error);
    return '';
  }
}

/**
 * 保存钱包信息到文件
 * @param info 钱包信息
 */
export async function saveWalletInfoToFile(info: WalletInfo): Promise<boolean> {
  try {
    // 使用Node.js原生API保存文件
    if (typeof process !== 'undefined') {
      const filePath = await initStorePath();
      if (!filePath) {
        console.error('无法确定存储文件路径');
        return false;
      }
      
      const jsonContent = JSON.stringify(info, null, 2);
      
      // 使用Node.js原生API写入文件
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, jsonContent, 'utf8');
      
      console.log(`钱包信息已保存到文件: ${filePath}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('保存钱包信息到文件失败:', error);
    return false;
  }
}

/**
 * 从文件读取钱包信息
 * @returns 钱包信息或null
 */
export async function readWalletInfoFromFile(): Promise<WalletInfo | null> {
  try {
    if (typeof process !== 'undefined') {
      const filePath = await initStorePath();
      if (!filePath) {
        console.error('无法确定存储文件路径');
        return null;
      }
      
      try {
        // 使用Node.js原生API读取文件
        const { readFile, access } = await import('node:fs/promises');
        const { constants } = await import('node:fs');
        
        // 检查文件是否存在
        try {
          await access(filePath, constants.R_OK);
        } catch {
          console.log(`钱包信息文件不存在: ${filePath}`);
          return null;
        }
        
        // 读取文件内容
        const content = await readFile(filePath, 'utf8');
        const walletInfo = JSON.parse(content) as WalletInfo;
        
        console.log(`从文件读取到钱包信息: ${walletInfo.walletAddress}`);
        return walletInfo;
      } catch (error) {
        console.error('读取钱包信息文件失败:', error);
        return null;
      }
    }
    
    return null;
  } catch (error) {
    console.error('读取钱包信息失败:', error);
    return null;
  }
} 