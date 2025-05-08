from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak, to_checksum_address
from hexbytes import HexBytes

PRIVATE_KEY = "542667984ecd2ef899fca4e6e10fc28fcfb964c47d820009d1c1e45451e0523f"
# === 1. 定义 domain 信息 ===
domain = {
    "name": "Gnosis Protocol",
    "version": "v2",
    "chainId": 11155111,  # Sepolia
    "verifyingContract": "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
}

# === 2. 定义 order 信息 ===
order = {
    "sellToken": to_checksum_address("0xfff9976782d46cc05630d1f6ebab18b2324d6b14"),
    "buyToken": to_checksum_address("0x0625afb445c3b6b7b929342a04a22599fd5dbb59"),
    "sellAmount": int("473107794665489160"),
    "buyAmount": int("164428962043613737416"),
    "validTo": int(1746436866),
    "appData": HexBytes("0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4"),
    "feeAmount": int(0),
    "kind": keccak(text="sell"),
    "partiallyFillable": False,
    "sellTokenBalance": keccak(text="erc20"),
    "buyTokenBalance": keccak(text="erc20"),
    "receiver": to_checksum_address("0x2f8A528EB0De3b43fD9Eb6f23D55C8D95fb7AF98"),
}

# === 3. 构造 EIP-712 typed data 格式 ===
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

# === 4. 计算 order digest ===
# 使用encode_typed_data生成签名哈希
signable_message = encode_typed_data(full_message=typed_data)
# SignableMessage是具有version、header和body的命名元组
# 对于EIP-712，body包含实际的哈希
digest = HexBytes(signable_message.body)

# === 5. 输出 digest ===
print("Order digest:", digest.hex())


account = Account.from_key(PRIVATE_KEY)

# === 1. 构造 Ethereum Signed Message 哈希 ===
eth_sign_message = b"\x19Ethereum Signed Message:\n32" + digest
eth_message_hash = keccak(eth_sign_message)

# === 2. 签名该哈希 ===
signed = Account._sign_hash(eth_message_hash, private_key=PRIVATE_KEY)

# === 3. 输出 signature（可直接提交给 CoW Protocol）===
signature = signed.signature.hex()
print("eth_sign signature:", signature)