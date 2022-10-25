# AVM 7 Demo
This demo aims to verify the following update from AVM 7

```
Unfunded accounts (with 0 microalgo) can now issue transactions as long as their fees are covered by fee pooling in the transaction group.
```

AVM 7 Updates
[https://github.com/algorand/go-algorand/releases/tag/v3.9.2-stable](https://github.com/algorand/go-algorand/releases/tag/v3.9.2-stable)

I'm using Algorand Sandbox for this test. The Algod version is `3.11.2`.

This demo basically does the following,
1. Deploy a simple counter app.
2. Create a standalone account with 0 algos.
3. Perform an atomic txn. This includes an app call txn from (2) and a payment txn from a loaded account to another.
4. The txn fees are modified - payment txn pays double txn fees to cover the app call txn.

