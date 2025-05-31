/**
 * ERC-4337 交易策略信号获取模块 (硬编码输出)
 *
 * 本模块提供一个演示性的功能，用于获取一个预设的或随机的交易策略信号。
 * 它不执行实际的策略计算，仅用于展示AI Agent基于策略生成信号的流程。
 *
 * 主要流程:
 * 1. (模拟)选择一个交易策略 (如 SMA, Bollinger Bands)
 * 2. (模拟)根据策略生成一个交易信号 (买入/卖出/观望)
 * 3. 返回格式化的信号信息
 */
import { type Action, type State, type Memory, type Handler, type HandlerCallback } from "@elizaos/core";

/**
 * 交易信号响应接口 (硬编码)
 */
interface GetTradingSignalResponse {
    strategyName: string;    // 模拟的策略名称
    signal: string;          // 模拟的交易信号 (e.g., "买入", "卖出", "观望")
    confidence?: number;     // 模拟的信号置信度 (0-1)
    pair?: string;           // 模拟的交易对
    isHardcoded: true;       // 明确指出这是硬编码结果
    description?: string;    // 信号描述
}

/**
 * 处理获取交易策略信号的主函数 (硬编码逻辑)
 *
 * @param runtime 运行时环境
 * @param message 内存对象
 * @param state 可选的状态对象
 * @param options 可选的参数对象 (例如，可以传入想模拟的交易对)
 * @param callback 可选的回调函数，用于返回操作结果
 * @returns 交易信号响应对象
 */
const getTradingSignalHandler: Handler = async (
    runtime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
) => {
    console.log("⭐ 开始执行 getTradingSignal 操作");

    try {
        // 模拟的参数，可以从 options 或 message 中获取，这里简单处理
        const pair = (options?.pair as string) || message?.content?.text?.split(" ").find(s => s.includes("USD")) || "BTCUSDT";

        // 预设的策略名称和信号
        const strategies = [
            { name: "SMA 均线交叉策略", signals: ["买入 (BUY)", "卖出 (SELL)", "继续持有 (HOLD)"] },
            { name: "Bollinger Bands 布林带策略", signals: ["触及下轨，考虑买入 (BUY)", "触及上轨，考虑卖出 (SELL)", "区间震荡，观望 (HOLD)"] },
            { name: "RSI 超买超卖策略", signals: ["RSI 低于30，超卖区，买入 (BUY)", "RSI 高于70，超买区，卖出 (SELL)", "RSI 中性，观望 (HOLD)"] }
        ];

        // 随机选择一个策略和信号
        const selectedStrategyInfo = strategies[Math.floor(Math.random() * strategies.length)];
        const selectedSignal = selectedStrategyInfo.signals[Math.floor(Math.random() * selectedStrategyInfo.signals.length)];
        const randomConfidence = Math.random() * (0.95 - 0.65) + 0.65; // 生成 0.65 到 0.95 之间的随机数

        // 5. 构建响应对象
        const response: GetTradingSignalResponse = {
            strategyName: selectedStrategyInfo.name,
            signal: selectedSignal,
            confidence: parseFloat(randomConfidence.toFixed(2)),
            pair: pair,
            isHardcoded: true,
            description: `这是一个基于 ${selectedStrategyInfo.name} 为 ${pair} 生成的模拟信号。`
        };

        // 6. 构建响应内容
        const signalInfoText = `
📈 模拟交易信号 (${pair}):
策略名称: ${response.strategyName}
交易信号: ${response.signal}
置信度 (模拟): ${response.confidence}
        
注意: 这是一个硬编码的演示信号，不构成任何实际投资建议。
        `.trim();

        console.log("模拟交易信号生成完成:", response);

        // 7. 如果有回调函数，执行回调
        if (callback) {
            await callback({
                text: signalInfoText
            });
        }

        return response;
    } catch (error) {
        console.error("⚠️ getTradingSignalHandler 错误:", error);
        const errorText = `获取模拟交易信号失败: ${error.message}`.trim();

        if (callback) {
            await callback({
                text: errorText
            });
        }
        throw error;
    }
};

/**
 * 验证 getTradingSignal 操作的函数
 *
 * 当前实现总是返回true，允许操作执行。
 *
 * @param runtime 运行时环境
 * @param message 内存对象
 * @param state 状态对象
 * @returns 布尔值，表示是否允许操作执行
 */
const validateGetTradingSignal = async (runtime, message, state) => {
    // 对于演示性的硬编码 Action，通常不需要复杂验证
    return true;
};

/**
 * 获取交易策略信号 Action 定义 (硬编码输出)
 *
 * 定义了完整的Action对象，包括名称、描述、处理函数和验证函数。
 */
export const getTradingSignalAction: Action = {
    name: "getTradingSignal",
    description: "获取一个预设的或随机的交易策略信号 (硬编码输出), 用于演示目的。",
    similes: [
        "获取交易建议", "查看策略信号", "给我一个交易信号", "现在该买还是卖",
        "市场策略", "交易信号", "BTC策略", "ETH信号", "模拟交易信号"
    ],
    handler: getTradingSignalHandler,
    validate: validateGetTradingSignal,
    examples: [
        [
            {
                user: "user1",
                content: {
                    text: "BTCUSDT 现在有什么交易信号吗？",
                }
            },
            {
                user: "agent",
                content: {
                    text: "正在为您查询 BTCUSDT 的模拟交易信号...",
                }
            }
        ],
        [
            {
                user: "user1",
                content: {
                    text: "给我一个 ETH 的 SMA 策略信号", // 尽管是硬编码，也可以设计成接受一些伪参数
                }
            },
            {
                user: "agent",
                content: {
                    text: "正在生成 ETH 的 SMA 模拟交易信号...",
                }
            }
        ],
        [
            {
                user: "user1",
                content: {
                    text: "查看布林带策略",
                }
            },
            {
                user: "agent",
                content: {
                    text: "好的，这是一个基于布林带策略的模拟信号...",
                }
            }
        ]
    ]
};