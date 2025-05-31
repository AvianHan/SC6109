/**
 * 基于链上数据的模拟策略信号模块
 *
 * 本模块提供了从公开API获取交易对的K线数据，
 * 然后应用一个简单的技术分析策略（如SMA或Bollinger Bands），
 * 最后输出一个模拟的交易信号。
 *
 * 主要流程:
 * 1. 从用户输入或默认配置中确定交易对和策略类型。
 * 2. 使用node-fetch调用交易所API获取K线数据。
 * 3. 根据选择的策略计算指标。
 * 4. 生成模拟的交易信号 (买入/卖出/观望)。
 * 5. 返回包含分析和信号的格式化信息。
 *
 * 注意: 此模块不执行真实交易，所有信号均为模拟。
 */
import { type Action, type State, type Memory, type Handler, type HandlerCallback } from "@elizaos/core";
import fetch from 'node-fetch'; // 用于发送HTTP请求

// --- 配置项 ---
const BINANCE_API_BASE_URL = "https://api.binance.com/api/v3/klines";
const DEFAULT_PAIR = "BTCUSDT";
const DEFAULT_INTERVAL = "1h"; // K线间隔: 1m, 5m, 15m, 1h, 4h, 1d
const KLINE_LIMIT = 100; // 获取最近100根K线

interface KlineData {
    openTime: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    closeTime: number;
    quoteAssetVolume: string;
    numberOfTrades: number;
    takerBuyBaseAssetVolume: string;
    takerBuyQuoteAssetVolume: string;
    ignore: string;
}

interface SimulatedSignalResponse {
    dataSource: string;
    pair: string;
    interval: string;
    strategyUsed: string;
    latestClosePrice: number | null;
    indicatorValues?: Record<string, number | string | null>;
    signal: string;
    analysisSummary: string;
    isSimulated: true;
}

// --- 技术指标计算辅助函数 ---

/**
 * 计算简单移动平均线 (SMA)
 * @param closePrices 收盘价数组
 * @param period 周期
 * @returns SMA值或null
 */
const calculateSMA = (closePrices: number[], period: number): number | null => {
    if (closePrices.length < period) return null;
    const sum = closePrices.slice(-period).reduce((acc, val) => acc + val, 0);
    return sum / period;
};

/**
 * 计算标准差
 * @param values 数值数组
 * @param mean 平均值
 * @returns 标准差
 */
const calculateStdDev = (values: number[], mean: number): number => {
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
};

/**
 * 计算布林带 (Bollinger Bands)
 * @param closePrices 收盘价数组
 * @param period 周期
 * @param stdDevMultiplier 标准差倍数
 * @returns 布林带对象 { upper, middle, lower } 或 null
 */
const calculateBollingerBands = (closePrices: number[], period: number, stdDevMultiplier: number): { upper: number; middle: number; lower: number } | null => {
    if (closePrices.length < period) return null;
    const relevantPrices = closePrices.slice(-period);
    const middle = calculateSMA(relevantPrices, period);
    if (middle === null) return null;

    const stdDev = calculateStdDev(relevantPrices, middle);
    const upper = middle + stdDev * stdDevMultiplier;
    const lower = middle - stdDev * stdDevMultiplier;
    return { upper, middle, lower };
};


/**
 * 处理基于链上数据的模拟策略信号的主函数
 */
const getChainDataStrategySignalHandler: Handler = async (
    runtime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
) => {
    console.log("⭐ 开始执行 getChainDataStrategySignal 操作");

    const userInput = message?.content?.text?.toLowerCase() || "";
    let pair = DEFAULT_PAIR;
    let strategyType = "SMA"; // 默认SMA策略

    // 简单提取用户意图中的交易对
    const pairMatch = userInput.match(/([A-Z]{3,6}USDT|[A-Z]{3,6}BTC|[A-Z]{3,6}ETH)/i);
    if (pairMatch && pairMatch[0]) {
        pair = pairMatch[0].toUpperCase();
    } else if (options?.pair as string) {
        pair = (options.pair as string).toUpperCase();
    }

    // 简单提取用户意图中的策略类型
    if (userInput.includes("bollinger") || userInput.includes("bbands") || userInput.includes("布林")) {
        strategyType = "BollingerBands";
    } else if (options?.strategyType as string && ((options.strategyType as string).toUpperCase() === "SMA" || (options.strategyType as string).toUpperCase() === "BOLLINGERBANDS")) {
        strategyType = (options.strategyType as string).toUpperCase();
    }

    console.log(`模拟策略: 交易对=${pair}, 策略类型=${strategyType}, K线间隔=${DEFAULT_INTERVAL}`);

    try {
        // 1. 获取K线数据
        const klinesUrl = `${BINANCE_API_BASE_URL}?symbol=${pair}&interval=${DEFAULT_INTERVAL}&limit=${KLINE_LIMIT}`;
        console.log(`正在从 ${klinesUrl} 获取数据...`);
        const response = await fetch(klinesUrl);
        if (!response.ok) {
            throw new Error(`获取K线数据失败 (${pair}): ${response.status} ${response.statusText}`);
        }
        const rawKlines: KlineData[] = await response.json() as KlineData[];
        if (!rawKlines || rawKlines.length === 0) {
            throw new Error(`未获取到 ${pair} 的K线数据`);
        }

        const closePrices = rawKlines.map(k => parseFloat(k.close));
        const latestClosePrice = closePrices.length > 0 ? closePrices[closePrices.length - 1] : null;

        if (latestClosePrice === null) {
            throw new Error("无法获取最新的收盘价");
        }

        // 2. 应用策略逻辑 (模拟)
        let signal = "无法确定 (N/A)";
        let analysisSummary = "";
        let indicatorValues: Record<string, number | string | null> = {};

        const smaPeriod = 20;
        const bbPeriod = 20;
        const bbStdDevMultiplier = 2;

        if (strategyType === "SMA") {
            const smaValue = calculateSMA(closePrices, smaPeriod);
            indicatorValues["SMA20"] = smaValue !== null ? parseFloat(smaValue.toFixed(4)) : null;

            if (smaValue !== null) {
                if (latestClosePrice > smaValue) {
                    signal = "买入信号 (模拟)";
                    analysisSummary = `当前价格 ${latestClosePrice} 高于 ${smaPeriod}周期 SMA (${indicatorValues["SMA20"]})，可能处于上升趋势。`;
                } else if (latestClosePrice < smaValue) {
                    signal = "卖出信号 (模拟)";
                    analysisSummary = `当前价格 ${latestClosePrice} 低于 ${smaPeriod}周期 SMA (${indicatorValues["SMA20"]})，可能处于下降趋势。`;
                } else {
                    signal = "观望信号 (模拟)";
                    analysisSummary = `当前价格 ${latestClosePrice} 接近 ${smaPeriod}周期 SMA (${indicatorValues["SMA20"]})，趋势不明朗。`;
                }
            } else {
                analysisSummary = `数据不足以计算 ${smaPeriod}周期 SMA。`;
            }
        } else if (strategyType === "BollingerBands") {
            const bands = calculateBollingerBands(closePrices, bbPeriod, bbStdDevMultiplier);
            if (bands) {
                indicatorValues["BB_Upper"] = parseFloat(bands.upper.toFixed(4));
                indicatorValues["BB_Middle"] = parseFloat(bands.middle.toFixed(4));
                indicatorValues["BB_Lower"] = parseFloat(bands.lower.toFixed(4));

                if (latestClosePrice < bands.lower) {
                    signal = "买入信号 (模拟)";
                    analysisSummary = `当前价格 ${latestClosePrice} 低于布林带下轨 (${indicatorValues["BB_Lower"]})，可能超卖。`;
                } else if (latestClosePrice > bands.upper) {
                    signal = "卖出信号 (模拟)";
                    analysisSummary = `当前价格 ${latestClosePrice} 高于布林带上轨 (${indicatorValues["BB_Upper"]})，可能超买。`;
                } else {
                    signal = "观望信号 (模拟)";
                    analysisSummary = `当前价格 ${latestClosePrice} 在布林带上下轨之间 (${indicatorValues["BB_Lower"]} - ${indicatorValues["BB_Upper"]})，盘整中。`;
                }
            } else {
                analysisSummary = `数据不足以计算 ${bbPeriod}周期 布林带。`;
            }
        }

        // 3. 构建响应
        const simResponse: SimulatedSignalResponse = {
            dataSource: "Binance API (模拟)",
            pair,
            interval: DEFAULT_INTERVAL,
            strategyUsed: strategyType,
            latestClosePrice: latestClosePrice,
            indicatorValues,
            signal,
            analysisSummary,
            isSimulated: true,
        };

        const responseText = `
📊 基于实时数据的模拟策略分析:
数据来源: ${simResponse.dataSource}
交易对: ${simResponse.pair} (${simResponse.interval})
策略: ${simResponse.strategyUsed}
最新收盘价: ${simResponse.latestClosePrice}
指标值: ${JSON.stringify(simResponse.indicatorValues, null, 2)}

分析概要: ${simResponse.analysisSummary}
模拟信号: ${simResponse.signal}

❗重要提示: 这是一个基于实时数据的模拟信号，不执行真实交易，不构成任何投资建议。
        `.trim();

        console.log("模拟策略信号生成完成:", simResponse);

        if (callback) {
            await callback({ text: responseText });
        }
        return simResponse;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`⚠️ getChainDataStrategySignalHandler 错误 (${pair}, ${strategyType}):`, errorMessage);
        const errorText = `获取 ${pair} 的 ${strategyType} 模拟策略信号失败: ${errorMessage}`;

        if (callback) {
            await callback({ text: errorText });
        }
        // 不建议在Action handler中直接抛出最外层错误，ElizaOS可能有自己的错误处理机制
        // 但如果需要，可以: throw error;
        return { // 返回一个错误结构，或者让Eliza Core处理
            error: true,
            message: errorText,
            isSimulated: true,
        };
    }
};

/**
 * 验证操作的函数
 */
const validateGetChainDataStrategySignal = async (runtime, message, state) => {
    return true; // 简单验证
};

/**
 * Action 定义
 */
export const getChainDataStrategySignalAction: Action = {
    name: "getChainDataStrategySignal",
    description: "获取真实市场数据并应用简单策略生成模拟交易信号 (不执行真实交易)。",
    similes: [
        "分析市场数据", "链上数据策略", "BTC实时策略", "ETH行情分析", "模拟盘信号",
        "获取BTCUSDT的SMA策略分析", "给我ETH的布林带模拟信号", "当前市场信号"
    ],
    handler: getChainDataStrategySignalHandler,
    validate: validateGetChainDataStrategySignal,
    examples: [
        [
            {
                user: "user1",
                content: {
                    text: "分析一下 BTCUSDT 使用SMA策略的情况",
                }
            },
            {
                user: "agent",
                content: {
                    text: "正在获取 BTCUSDT 的市场数据并使用SMA策略进行模拟分析...",
                }
            }
        ],
        [
            {
                user: "user1",
                content: {
                    text: "ETHUSDT 布林带策略信号",
                }
            },
            {
                user: "agent",
                content: {
                    text: "正在获取 ETHUSDT 的市场数据并使用布林带策略进行模拟分析...",
                }
            }
        ],
        [
            {
                user: "user1",
                content: {
                    text: "当前 XRPUSDT 市场信号是什么？", // 默认可能会用SMA
                }
            },
            {
                user: "agent",
                content: {
                    text: "正在获取 XRPUSDT 的市场数据进行模拟策略分析...",
                }
            }
        ]
    ]
};
