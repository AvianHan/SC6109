# Eliza: AI-Powered On-Chain Agent Protocol

**Making Blockchain Wallet Operations as Simple as Chatting**

## Overview

Eliza is an AI-Powered On-Chain Agent Protocol that simplifies blockchain wallet operations using natural language. It aims to make interacting with blockchain technology as easy as having a conversation.

For a detailed presentation of the project, please see the [project slides](https://docs.google.com/presentation/d/1J8uCyXk8fDRJTNoia_6so95OiGRL0l4HssXoRDCTOdE/edit?usp=sharing).

## Problem & Solution

Traditional wallets can be complex, requiring technical knowledge and involving multiple steps. Eliza offers a streamlined experience through:

* Natural language interaction
* Intelligent operation parsing
* One-sentence command completion
* Smart error recovery

## Core Features

* Powerful Natural Language Processing
* Plugin-based Architecture
* Long-term & Short-term Memory
* Multi-modal Interaction Support
* Blockchain Native Integration

## Technical Advantages

* Full-stack TypeScript development
* Modular component design
* Rich plugin ecosystem

## ERC-4337 Account Abstraction Benefits

Eliza utilizes ERC-4337 for features like:

* Third-party gas sponsorship
* Social recovery mechanisms
* Batch operation support
* Programmable wallet logic

## Core Functions (Examples)

Eliza understands natural language commands to perform core blockchain operations:

* **`deployWallet`**: Deploys your ERC-4337 smart contract wallet (e.g., "I want to deploy an ERC-4337 wallet")[cite: 7].
* **`getWalletInfo`**: Queries your wallet's status and information (e.g., "Check my wallet information")[cite: 8].
* **`executeTransaction`**: Executes transfers and contract calls (e.g., "Send 0.1 ETH to `0x123....`")[cite: 9].
* **`swapTokens`**: Performs intelligent token swaps, with simulation for safety (e.g., "Swap 3 USDC to WETH")[cite: 10].
* **`quantStrategy`**: Analyzes token pairs using quantitative strategies (e.g., "Analyze BTC/USDT using Bollinger Bands strategy")[cite: 11].

## Technical Architecture

Eliza features a modular architecture with components for user interaction, an agent runtime, knowledge storage, core processing, and ERC-4337 integration[cite: 5].

## Getting Started

### Prerequisites

* Ubuntu recommended
* Git, cURL
* Node Version Manager (NVM)
* Node.js v18
* pnpm

### Installation

1.  **Clone Repository:**
    ```bash
    git clone [https://github.com/AvianHan/SC6109.git](https://github.com/AvianHan/SC6109.git)
    cd SC6109 # Or your chosen project directory name (e.g., eliza)
    ```
2.  **Initialize Submodules (if any):**
    ```bash
    git submodule update --init
    ```
3.  **Install NVM & Node.js v18:**
    ```bash
    curl -o- [https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh](https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh) | bash
    source ~/.bashrc # Or ~/.zshrc
    nvm install 18
    nvm use 18
    ```
4.  **Install pnpm:**
    ```bash
    npm install -g pnpm
    ```
5.  **Install Dependencies:**
    ```bash
    pnpm install --no-frozen-lockfile
    ```

### Configuration

1.  **Set up `.env`:**
    ```bash
    cp .env.example .env
    ```
2.  **Edit `.env`:** Add your `OPEN_API_KEY` and other necessary variables.

### Build Project
```bash
pnpm build
