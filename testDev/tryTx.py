from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak, to_checksum_address
from hexbytes import HexBytes
import json
import requests
import binascii
import eth_utils

# === 配置 ===
PRIVATE_KEY = "542667984ecd2ef899fca4e6e10fc28fcfb964c47d820009d1c1e45451e0523f"
ADDRESS = Web3.to_checksum_address("0x2f8A528EB0De3b43fD9Eb6f23D55C8D95fb7AF98")
web3 = Web3(Web3.HTTPProvider("https://ethereum-sepolia.publicnode.com"))

# === Token 合约 ===
WETH = Web3.to_checksum_address("0xfff9976782d46cc05630d1f6ebab18b2324d6b14")
COW = Web3.to_checksum_address("0x0625aFB445C3B6B7B929342a04A22599fd5dBB59")
COWSWAP_CONTRACT = Web3.to_checksum_address("0x9008d19f58aabd9ed0d60971565aa8510560ab41")

def get_order_quote():
    """获取订单报价"""
    print("正在获取订单摘要...")
    quote_response = requests.post(
        "https://api.cow.fi/sepolia/api/v1/quote",
        json={
            "sellToken": WETH,
            "buyToken": COW,
            "receiver": ADDRESS,
            "sellAmountBeforeFee": str(Web3.to_wei(0.10, "ether")),
            "kind": "sell",
            "partiallyFillable": True,
            "from": ADDRESS.lower()
        }
    )

    if quote_response.status_code == 200:
        quote_data = quote_response.json()
        print("成功获取报价:", quote_data)
        return quote_data
    else:
        print(f"获取报价失败: {quote_response.status_code}")
        print(quote_response.text)
        return None

def construct_order(quote_data):
    """构造订单"""
    # 构造正确的 appData
    app_data = {
        "version": "0.9.0",
        "metadata": {}
    }
    app_data_json = json.dumps(app_data)
    app_data_hash = Web3.keccak(text=app_data_json).hex()
    
    order = {
        "sellToken": quote_data["quote"]["sellToken"],
        "buyToken": quote_data["quote"]["buyToken"],
        "sellAmount": quote_data["quote"]["sellAmount"],
        "buyAmount": quote_data["quote"]["buyAmount"],
        "validTo": quote_data["quote"]["validTo"],
        "appData": "0x" + app_data_hash,  # 使用哈希值
        "feeAmount": quote_data["quote"]["feeAmount"],
        "kind": quote_data["quote"]["kind"],
        "partiallyFillable": quote_data["quote"]["partiallyFillable"],
        "sellTokenBalance": quote_data["quote"]["sellTokenBalance"],
        "buyTokenBalance": quote_data["quote"]["buyTokenBalance"],
    }
    
    # 添加额外字段
    order["receiver"] = quote_data["quote"]["receiver"]
    order["from"] = quote_data["from"]
    order["kind"] = quote_data["quote"]["kind"]
    order["signingScheme"] = quote_data["quote"]["signingScheme"]
    order["appDataHash"] = "0x" + app_data_hash
    
    return order

def sign_order(order):
    """签名订单"""
    # 定义 domain 信息
    domain = {
        "name": "Gnosis Protocol",
        "version": "v2",
        "chainId": 11155111,  # Sepolia
        "verifyingContract": COWSWAP_CONTRACT,
    }

    # 构造 EIP-712 typed data 格式
    typed_data = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "Order": [
                {"name": "sellToken", "type": "address"},
                {"name": "buyToken", "type": "address"},
                {"name": "sellAmount", "type": "uint256"},
                {"name": "buyAmount", "type": "uint256"},
                {"name": "validTo", "type": "uint32"},
                {"name": "appData", "type": "bytes32"},
                {"name": "feeAmount", "type": "uint256"},
                {"name": "kind", "type": "bytes32"},
                {"name": "partiallyFillable", "type": "bool"},
                {"name": "sellTokenBalance", "type": "bytes32"},
                {"name": "buyTokenBalance", "type": "bytes32"},
                {"name": "receiver", "type": "address"},
            ]
        },
        "primaryType": "Order",
        "domain": domain,
        "message": order,
    }

    # 生成签名
    signable_message = encode_typed_data(full_message=typed_data)
    digest = HexBytes(signable_message.body)
    eth_sign_message = b"\x19Ethereum Signed Message:\n32" + digest
    eth_message_hash = keccak(eth_sign_message)
    # 使用私钥签名
    account = Account.from_key(PRIVATE_KEY)
    signed = Account._sign_hash(eth_message_hash, private_key=PRIVATE_KEY)  # 使用 sign_hash 而不是 _sign_hash
    
    return signed.signature.hex()

def submit_order(order, signature):
    """提交订单"""
    order["signature"] = "0x" + signature
    if order["signature"]:
        print("正在提交订单...")
        submit_response = requests.post(
            "https://api.cow.fi/sepolia/api/v1/orders",
            json=order
        )
        print(f"状态码: {submit_response.status_code}")
        print(f"返回内容: {submit_response.text}")
        return submit_response
    return None

def main():
    # 1. 获取报价
    quote_data = get_order_quote()
    if not quote_data:
        return

    # 2. 构造订单
    order = construct_order(quote_data)
    print("构造的订单:", order)

    try:
        # 3. 签名订单
        signature = sign_order(order)
        print("生成的签名:", signature)

        # 4. 提交订单
        submit_order(order, signature)
    except ValueError as e:
        print(f"错误: {e}")
        return

if __name__ == "__main__":
    main()