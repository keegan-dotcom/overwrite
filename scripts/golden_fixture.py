"""Generate golden signing fixture with the OFFICIAL derive_action_signing lib."""
import json
from decimal import Decimal
from derive_action_signing import SignedAction, sign_rest_auth_header
from derive_action_signing.module_data.trade import TradeModuleData
from web3 import Web3
from eth_account.messages import encode_defunct

PK = "0x" + "ab" * 32
W3 = Web3()
acct = W3.eth.account.from_key(PK)

md = TradeModuleData(
    asset_address="0xBcB494059969DAaB460E0B5d4f5c2366aab79aa1",  # ETH_OPTION testnet
    sub_id=39614082287924319838483674368,
    limit_price=Decimal("41.5"),
    amount=Decimal("0.3"),
    max_fee=Decimal("1000"),
    recipient_id=144481,
    is_bid=False,
)
action = SignedAction(
    subaccount_id=144481,
    owner="0x55853CB4f27aDD6d2aB8AE0Fe7437Fd6A4DD482d",
    signer=acct.address,
    signature_expiry_sec=1790000000,
    nonce=1755550000000001,
    module_address="0x87F2863866D85E3192a35A73b388BD625D83f2be",
    module_data=md,
    DOMAIN_SEPARATOR="0x9bcf4dc06df5d8bf23af818d5716491b995020f377d3b7b64c29ed14e3dd1105",
    ACTION_TYPEHASH="0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17",
)
sig = action.sign(PK)
ts = "1755550001234"
auth_sig = W3.eth.account.sign_message(encode_defunct(text=ts), private_key=PK).signature.hex()

print(json.dumps({
    "signer": acct.address,
    "module_data_encoded": "0x" + md.to_abi_encoded().hex(),
    "action_hash": "0x" + action._get_action_hash().hex(),
    "typed_data_hash": "0x" + action._to_typed_data_hash().hex(),
    "signature": sig if sig.startswith("0x") else "0x" + sig,
    "auth_ts": ts,
    "auth_signature": auth_sig if auth_sig.startswith("0x") else "0x" + auth_sig,
}, indent=1))
