/**
 * 格式化十六进制gas值
 * 确保所有gas值都是有效的偶数长度十六进制字符串，
 * 这是以太坊字节编码的要求。
 */

export function evenGas(gasEstimate: any) {
    if (gasEstimate.callGasLimit) {
        // 移除0x前缀，确保长度为偶数，再添加前缀
        let hex = gasEstimate.callGasLimit.toString().replace('0x', '');
        if (hex.length % 2 !== 0) {
        hex = '0' + hex;
    }
    gasEstimate.callGasLimit = '0x' + hex;
}

    if (gasEstimate.verificationGasLimit) {
        let hex = gasEstimate.verificationGasLimit.toString().replace('0x', '');
        if (hex.length % 2 !== 0) {
            hex = '0' + hex;
        }
        gasEstimate.verificationGasLimit = '0x' + hex;
    }

    if (gasEstimate.preVerificationGas) {
        let hex = gasEstimate.preVerificationGas.toString().replace('0x', '');
        if (hex.length % 2 !== 0) {
            hex = '0' + hex;
            }
            gasEstimate.preVerificationGas = '0x' + hex;
        }
    return gasEstimate;
}

export default evenGas;