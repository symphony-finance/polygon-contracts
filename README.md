# Symphony Finance Contracts

This is the core contracts of [symphony finance](https://symphony.finance/).

## Setup

### Env variables

Create a `.env` file based on `sample.env`. Then, run:

### Install dependencies

```
npm install
```

You can use postgress directly or pgadmin.

## Run Test

- Start the mainnet fork using `npm run start:fork`
- In a new terminal, run `npm run test` to run the test.


## Exploring The Code

1. The **contracts** code lives in the `/contracts` folder.

   This code gets deployed to the blockchain when you run `npm run setup:symphony`. 
   - The best place to start is `symphony.sol`, which is the main contract.
   - All handlers are present in `/handlers`, which is used to execute orders.
   - The adapters are used to generate yield and are present inside `/adapters` folder.

2. The tests are present in the `/test` folder.

3. The deployment scripts are in `/scripts` folder.
 
##
For any ❓: [Discord](https://discord.gg/APwngPCjdT)

