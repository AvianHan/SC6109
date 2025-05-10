/**
 * 安全地将任何值转换为数字
 * 
 * 处理各种类型的输入（包括Promise、BigNumber、BigInt和字符串）并尝试将其转换为数字。
 * 
 * 特别处理了以下情况：
 * - null或undefined值
 * - Promise对象（自动等待解析）
 * - BigNumber或类BigNumber对象
 * - 其他具有toString方法的对象
 * - 字符串和数字类型的直接转换
 * 
 * 
 * @param value 要转换的值，可以是任何类型
 * @param defaultValue 转换失败时返回的默认值
 * @returns 转换后的数字或提供的默认值
 */

async function safeToNumber(value: any, defaultValue: number): Promise<number> {
    try {
        // 处理空值
        if (value === null || value === undefined) {
            console.log("safeToNumber: 值为空，返回默认值", defaultValue);
            return defaultValue;
        }
        
        // 处理Promise
        if (value && typeof value === 'object' && value.then) {
            console.log("safeToNumber: 值是Promise，等待解析...");
            try {
                value = await value;
                console.log("safeToNumber: Promise解析成功，结果类型:", typeof value);
            } catch (error) {
                console.error("safeToNumber: Promise解析失败:", error);
                return defaultValue;
            }
        }
        
        // 处理BigNumber、BigInt等对象
        if (value && typeof value === 'object') {
            if (value._isBigNumber || value.type === 'BigNumber') {
                console.log("safeToNumber: 值是BigNumber对象");
                return value.toNumber();
            }
            if (typeof value.toString === 'function') {
                console.log("safeToNumber: 值是对象，使用toString()");
                value = value.toString();
            }
        }
        
        // 处理字符串和数字
        if (typeof value === 'string' || typeof value === 'number') {
            const num = Number(value);
            if (!isNaN(num)) {
                return num;
            }
            console.log("safeToNumber: 不是有效数字:", value);
        }
        
        console.log("safeToNumber: 无法转换为数字，返回默认值", defaultValue);
        return defaultValue;
    } catch (error) {
        console.error("safeToNumber: 出错，返回默认值:", error);
        return defaultValue;
    }
}

export default safeToNumber;