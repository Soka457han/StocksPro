# StocksPro

**StocksPro is a strategy lab for tokenized U.S. stocks on Bitget: the LLM proposes, a deterministic harness decides, and every decision leaves a receipt.**

Pick a tokenized stock, set the strategy parameters, backtest on real Bitget history, and see the same rules side by side with the risk harness ON and OFF. Then check the same setup against live data. It is not copy trading, not a market-analysis chatbot, and not a black-box bot.

## Submission Summary

- **Hackathon:** Bitget AI Hackathon, Genesis Season 2 (Builder OS)
- **Track:** Agentic Trading
- **Sub-theme:** Open Theme, agent evaluation and benchmarks (risk-violation rate, value over a fixed-rule baseline)
- **Live demo:**  (https://stockspro.vercel.app/)
- **Repository:**  (https://github.com/Soka457han/StocksPro)
- **Symbols:** `NVDAUSDT`, `METAUSDT`, `GOOGLUSDT`, `AAPLUSDT`, `AMZNUSDT`, plus `TSLAUSDT`, `MSFTUSDT` (Bitget USDT perpetual futures, `isRwa`)
- **Results:** none are claimed in this README. Run the Lab and read the numbers it shows. Add your own measured numbers here only after you have run them.

## Review In 90 Seconds

1. Open the live app: https://stockspro.vercel.app/
2. Choose a stock and press **Run backtest**.
3. Read the **Harness ON vs OFF** chart and table. Same signals, same data; only the governor differs.
4. Read **Vetoes by rule** to see which setups the harness refused and why.
5. Press **Check live data** to see the perp price, the U.S. stock quote, the reference gap and the gap rule verdict.
6. Press **Copy prompt** under **Export to Playbook** and paste it into GetAgent Skill to run Bitget's own backtest for comparison.

The core claim to verify :

```
Signal on closed bar -> governor checks -> next-bar fill with fees and slippage -> metrics -> receipt
```

## Why This Exists

Most trading agents optimize for activity. StocksPro optimizes for disciplined, checkable decisions.

- A model that has read the internet already knows what happened last year. Letting it trade a backtest is look-ahead bias. So **the LLM is never used in backtests**. Backtests use deterministic rules only.
- The LLM is used only in Live mode, where it proposes and the harness has the final say. Every live decision is saved as a timestamped, checksummed receipt, whether it was approved or vetoed.
- Tokenized stocks trade 24/7 but the underlying market does not. That creates risks a crypto-only agent never sees: weekend and after-hours gaps, earnings events, and a token price drifting from the real stock price. The governor is built around those.

## Live vs Simulated Boundary

| Surface | Mode | What it proves | Data source |
|---|---|---|---|
| Lab backtest | Historical simulation | Deterministic rules, with and without the governor, on real Bitget candles | Bitget `history-candles` (USDT-FUTURES) |
| Live check | Live read-only | Current perp price, funding, stock reference quote, fear and greed | Bitget futures ticker, Bitget MCP |
| Earnings blackout | Historical dates | Past disclosure dates used to block entries near earnings | Bitget MCP `equity_calendar` |
| Playbook export | Prompt only | A way to cross-check the Lab against an official GetAgent backtest | GetAgent Skill (run by you) |

StocksPro places no orders and uses no real capital. Everything is backtest or paper. It claims disciplined, reproducible simulation and verifiable refusal, not real-capital PnL or guaranteed profit. This is not financial advice.

## Project Description

StocksPro is a strategy lab for tokenized U.S. stocks on Bitget. A trader picks a stock such as NVDA, sets entry, exit, stop and sizing rules, and backtests on real Bitget futures candles. The same rules run twice, once with a risk harness ON and once OFF, so the value of risk control is measured, not claimed. The harness checks volatility percentile per stock, trend strength, earnings blackout, a leverage cap and a drawdown halt, and it reports every setup it blocked. Backtests never use an LLM, which removes look-ahead bias. In Live mode, Qwen proposes a trade but cannot widen stops or bypass the governor, and each decision is saved as a checksummed receipt. Live checks compare the token price with the real stock quote from Bitget MCP and veto when the gap is too large. Every number on the page carries a data-source label, and the simulation boundary is stated clearly.

## Track : AI Trading Desk 
Sub-theme : Decision Stress Testing


## Thesis :
Stock markets close. Tokenized stocks don't. Every weekend and every earnings night, a small trader is left alone with a price that may not match the real stock. I believe an AI agent is only as good as the rules that can say "no". So StocksPro runs the same strategy twice on real Bitget data, once with a risk harness and once without, and shows what the harness blocked and why. Backtests use no LLM, so the past can't be peeked at. In Live mode the AI only proposes. The harness decides.

Target user and product value -
Assumed segment (not measured) : a retail trader of tokenized U.S. stocks on Bitget perpetuals, small account, moderate risk appetite, a few trades a week. Most tools show them returns. None show what protection would have been worth.

Validation data and key metrics -
No performance claims, Observed : about 8 months of NVDAUSDT history, taker fee 0.06%. [Paste your own measured Sharpe, max drawdown and win rate from the Lab here, labeled observed.] Targeted: out-of-sample test of 30+ days and a 2+ week paper run. No users yet.

Progress -
Built : data API, backtest engine, risk harness, ON vs OFF comparison, live price-gap check. Not built yet: Qwen live proposals, receipts, scheduled paper trading. Tools: Bitget futures API, Bitget MCP, Vercel.

My take -
AI trading won't be trusted for how smart it is, but for how clearly it can say no. I built StocksPro to make that visible.


## How It Works

### 1. Data layer (`api/data.js`)

One Vercel serverless function, no API keys.

| Request | Returns |
|---|---|
| `/api/data?type=candles&symbol=NVDAUSDT&gran=1D` | Closed futures candles (`1D`, `4H`, `1H`), fetched in windows and stitched, open bars dropped |
| `/api/data?type=live&symbol=NVDAUSDT` | Futures ticker, funding rate, fees, max leverage, U.S. stock quote and fear and greed from Bitget MCP |
| `/api/data?type=calendar&symbol=NVDAUSDT` | Earnings disclosure dates from Bitget MCP `equity_calendar` |

Facts that shaped the design (verified by probing):
- `candles` returns only the latest 90 daily bars, so history comes from `history-candles` in chunks (limit 1 to 200, needs both `startTime` and `endTime`).
- NVDAUSDT opened about 2 Feb 2026, so roughly eight months of history exist.
- A gap of about +0.28% between the perp last price and the stock quote was observed in one probe, which is why the reference-gap rule exists.

### 2. Backtest engine (in `index.html`)

- Entry: RSI(14) below your threshold, long only. Exit: RSI above your threshold, stop loss, take profit, or time stop.
- Signal on bar close, fill on the **next bar open**, with taker fee (default 0.06%) and slippage. No look-ahead.
- If stop and target are both touched in one bar, the stop is assumed to hit first.
- Liquidation is approximated at about 90% of margin, so high leverage cannot hide a wipe-out.
- Funding is ignored (current funding rate is 0 on the probed contract).

### 3. Governor (risk harness)

| Rule | What it blocks |
|---|---|
| Volatility percentile | Entries when ATR% is above your percentile of that stock's own recent history |
| Trend filter (ADX) | Mean-reversion entries while a strong trend is running |
| Earnings blackout | Entries within 2 days of a disclosure date |
| Leverage cap | Any leverage above your cap (for example 3x), even if you asked for more |
| Drawdown halt | All new entries after equity falls past your drawdown limit |
| Reference gap (Live) | A live setup when the perp and the stock quote disagree by more than 0.5% |

Hard exits (stop loss, time stop) live in code. The LLM cannot widen them.

### 4. Live mode and receipts (in progress)

Qwen proposes through a server-side function, the governor approves or vetoes, and the decision is saved with a timestamp and checksum. See the status table below for what is built.

### 5. Export to Playbook

The Lab turns your parameters into a prompt for GetAgent Skill, so Bitget's sandbox can run an official backtest to compare against the Lab. The page makes no GetAgent API call, and no key is needed on the site.

## Status

| Item | Status |
|---|---|
| Futures candles, live ticker, MCP quote, earnings calendar | Built and probed |
| Strategy Lab with Harness ON vs OFF | Built |
| Live check page (reference gap rule) | Built |
| Export to Playbook prompt | Built |
| Qwen proposal endpoint and Live decisions | Planned |
| Receipts with checksums and Ledger page | Planned |
| Scheduled live cycles and paper trading log (2+ weeks recommended) | Planned |
| In-sample and out-of-sample split | Planned |
| Intraday history depth back to February | Not yet tested |




## What Is Real vs. What Is Not Claimed

Real:
- Real Bitget futures candles, ticker, funding and contract data.
- Real U.S. stock quote, earnings calendar and fear and greed from the Bitget MCP server.
- Deterministic backtests with fees, slippage and next-bar fills.
- The governor's refusals are counted and shown per rule.

Not claimed:
- No real-capital PnL, no guaranteed returns, no profit promise.
- No official GetAgent leaderboard rank or run ID unless you have one you can link.
- No Live receipts or paper trading log until the scheduled cycles are running.
- The only reference-gap figure so far (+0.28%) came from a single probe on a Sunday, when the stock quote was probably the last close. It is not a statistic.


## What Is it giving :


- Strategy Lab with real historical backtests
- Harness ON vs OFF comparison and per-rule veto counts 
- Tokenized-stock-specific rules: earnings blackout, reference-price gap, per-stock volatility percentile
- Real U.S. stock data through Bitget MCP
- Export to Playbook cross-check


## Repository Structure

```

├── index.html        # StocksPro Lab: UI, backtest engine, governor, live panel
├── api/
│   └── data.js       # candles, live snapshot, earnings calendar (no keys)
└── README.md
```

Planned: `api/propose.js` (Qwen), a receipts folder, and a scheduled GitHub Actions workflow. Delete any `api/probe*.js` files before submission.

## Run Locally

```
git clone https://github.com/Soka457han/StocksPro
cd StocksPro
npm i -g vercel
vercel dev
```

Open the local URL it prints. No environment variables are needed for the current build. Opening `index.html` directly will not work, because `/api/data` only exists under Vercel.



## Links

- Live app: https://stockspro.vercel.app/
- GitHub: https://github.com/Soka457han/StocksPro
- Bitget AI Hackathon: <https://www.bitget.com/activity-hub/hackathon>
