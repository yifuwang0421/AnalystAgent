#!/usr/bin/env python3
"""Optional read-only finance provider bridge for Analyst Agent.

The TypeScript tool calls this script only when a Python-backed provider is
selected. Dependencies are intentionally optional: when a package is missing,
the script returns a structured unavailable result instead of failing the turn.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def unavailable(provider: str, reason: str, request: dict[str, Any]) -> dict[str, Any]:
    return {
        "providerAvailable": False,
        "provider": provider,
        "request": request,
        "dataAsOf": now_iso(),
        "raw": None,
        "normalized": None,
        "warnings": [reason],
        "reason": reason,
    }


def safe_records(value: Any, limit: int = 50) -> Any:
    try:
        if hasattr(value, "tail"):
            value = value.tail(limit)
        if hasattr(value, "reset_index"):
            value = value.reset_index()
        if hasattr(value, "to_dict"):
            return value.to_dict(orient="records")
    except Exception:
        return str(value)
    return value


def yfinance_provider(request: dict[str, Any]) -> dict[str, Any]:
    try:
        import yfinance as yf  # type: ignore
    except Exception as exc:
        return unavailable("yfinance", f"yfinance is not installed: {exc}", request)

    symbol = (request.get("symbol") or request.get("query") or "").strip()
    if not symbol:
        return unavailable("yfinance", "symbol or query is required.", request)

    ticker = yf.Ticker(symbol)
    request_type = request.get("requestType")
    raw: Any

    if request_type == "get_historical_prices":
        raw = ticker.history(
            period=request.get("period") or "1y",
            start=request.get("startDate"),
            end=request.get("endDate"),
        )
        normalized = {"format": "records", "rows": safe_records(raw)}
    elif request_type == "get_valuation_metrics":
        info = ticker.get_info()
        keys = [
            "marketCap",
            "trailingPE",
            "forwardPE",
            "priceToBook",
            "enterpriseValue",
            "enterpriseToRevenue",
            "enterpriseToEbitda",
        ]
        normalized = {"format": "metrics", "metrics": {key: info.get(key) for key in keys}}
        raw = info
    elif request_type == "get_financial_summary":
        raw = {
            "income_statement": safe_records(ticker.income_stmt),
            "balance_sheet": safe_records(ticker.balance_sheet),
            "cashflow": safe_records(ticker.cashflow),
        }
        normalized = {"format": "statements", "data": raw}
    elif request_type == "get_financial_statements":
        statement_type = request.get("statementType") or "all"
        statement_map = {
            "income": ticker.income_stmt,
            "balance": ticker.balance_sheet,
            "cashflow": ticker.cashflow,
        }
        if statement_type == "all":
            raw = {key: safe_records(value) for key, value in statement_map.items()}
        else:
            raw = safe_records(statement_map.get(statement_type))
        normalized = {"format": "statement", "statementType": statement_type, "data": raw}
    elif request_type == "get_news":
        raw = ticker.news
        normalized = {"format": "news", "items": raw[:20] if isinstance(raw, list) else raw}
    elif request_type == "get_technical_indicators":
        hist = ticker.history(period=request.get("period") or "6mo")
        close = hist["Close"] if hasattr(hist, "__getitem__") and "Close" in hist else None
        if close is not None:
            hist = hist.copy()
            hist["MA20"] = close.rolling(20).mean()
            hist["MA60"] = close.rolling(60).mean()
        raw = hist
        normalized = {"format": "technical", "rows": safe_records(raw)}
    else:
        raw = ticker.get_info()
        normalized = {"format": "quote", "data": raw}

    return {
        "providerAvailable": True,
        "provider": "yfinance",
        "library": "yfinance",
        "request": request,
        "dataAsOf": now_iso(),
        "raw": raw if isinstance(raw, (dict, list, str, int, float, type(None))) else safe_records(raw),
        "normalized": normalized,
        "warnings": [],
    }


def edgartools_provider(request: dict[str, Any]) -> dict[str, Any]:
    try:
        from edgar import Company, set_identity  # type: ignore
    except Exception as exc:
        return unavailable("edgartools", f"edgartools is not installed: {exc}", request)

    identity = (
        request.get("edgarIdentity")
        or "AnalystAgent research tool contact@example.com"
    )
    try:
        set_identity(identity)
        symbol = (request.get("symbol") or request.get("query") or "").strip()
        if not symbol:
            return unavailable("edgartools", "symbol or query is required.", request)
        company = Company(symbol)
        filings = company.get_filings().latest(10)
        raw = str(filings)
        return {
            "providerAvailable": True,
            "provider": "edgartools",
            "library": "edgartools",
            "request": request,
            "dataAsOf": now_iso(),
            "raw": raw,
            "normalized": {"format": "filings_summary", "text": raw},
            "warnings": [],
        }
    except Exception as exc:
        return unavailable("edgartools", f"edgartools request failed: {exc}", request)


def tushare_provider(request: dict[str, Any]) -> dict[str, Any]:
    try:
        import tushare as ts  # type: ignore
    except Exception as exc:
        return unavailable("tushare", f"tushare is not installed: {exc}", request)

    token = (
        request.get("tushareToken")
        or os.environ.get("TUSHARE_TOKEN")
        or os.environ.get("TUSHARE_API_TOKEN")
    )
    if not token:
        return unavailable(
            "tushare",
            "TUSHARE_TOKEN is not set. Configure it outside the repository before using the tushare provider.",
            request,
        )

    symbol = (request.get("symbol") or request.get("query") or "").strip()
    request_type = request.get("requestType")
    try:
        pro = ts.pro_api(token)
        if request_type == "search_instruments":
            raw = pro.stock_basic(
                exchange="",
                list_status="L",
                fields="ts_code,symbol,name,area,industry,list_date",
            )
            if symbol:
                text = symbol.lower()
                records = safe_records(raw, limit=500)
                raw = [
                    row for row in records
                    if text in str(row.get("ts_code", "")).lower()
                    or text in str(row.get("symbol", "")).lower()
                    or text in str(row.get("name", "")).lower()
                ][:50]
            normalized = {"format": "instruments", "rows": safe_records(raw)}
        elif request_type == "get_historical_prices":
            raw = pro.daily(
                ts_code=symbol,
                start_date=(request.get("startDate") or "").replace("-", ""),
                end_date=(request.get("endDate") or "").replace("-", ""),
            )
            normalized = {"format": "records", "rows": safe_records(raw)}
        elif request_type == "get_valuation_metrics":
            raw = pro.daily_basic(
                ts_code=symbol,
                start_date=(request.get("startDate") or "").replace("-", ""),
                end_date=(request.get("endDate") or "").replace("-", ""),
                fields="ts_code,trade_date,close,turnover_rate,volume_ratio,pe,pb,ps,dv_ratio,total_mv,circ_mv",
            )
            normalized = {"format": "metrics", "rows": safe_records(raw)}
        elif request_type == "get_financial_statements":
            statement_type = request.get("statementType") or "all"
            statements: dict[str, Any] = {}
            if statement_type in ("income", "all"):
                statements["income"] = safe_records(pro.income(ts_code=symbol, period=request.get("period") or ""))
            if statement_type in ("balance", "all"):
                statements["balance"] = safe_records(pro.balancesheet(ts_code=symbol, period=request.get("period") or ""))
            if statement_type in ("cashflow", "all"):
                statements["cashflow"] = safe_records(pro.cashflow(ts_code=symbol, period=request.get("period") or ""))
            raw = statements
            normalized = {"format": "statement", "statementType": statement_type, "data": statements}
        elif request_type == "get_financial_summary":
            raw = pro.fina_indicator(ts_code=symbol, period=request.get("period") or "")
            normalized = {"format": "financial_indicators", "rows": safe_records(raw)}
        else:
            raw = pro.daily(ts_code=symbol, trade_date=(request.get("endDate") or "").replace("-", ""))
            normalized = {"format": "quote", "rows": safe_records(raw)}

        return {
            "providerAvailable": True,
            "provider": "tushare",
            "library": "tushare",
            "request": request,
            "dataAsOf": now_iso(),
            "raw": raw if isinstance(raw, (dict, list, str, int, float, type(None))) else safe_records(raw),
            "normalized": normalized,
            "warnings": [],
        }
    except Exception as exc:
        return unavailable("tushare", f"tushare request failed: {exc}", request)


def local_cn_provider(provider: str, request: dict[str, Any]) -> dict[str, Any]:
    try:
        if provider == "akshare":
            import akshare  # noqa: F401  # type: ignore
        elif provider == "baostock":
            import baostock  # noqa: F401  # type: ignore
    except Exception as exc:
        return unavailable(provider, f"{provider} is not installed: {exc}", request)

    return unavailable(
        provider,
        f"{provider} runtime is installed, but this v1 bridge only exposes yfinance/edgartools live calls. Use iFinD for A/H data.",
        request,
    )


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception as exc:
        print(json.dumps(unavailable("python", f"Invalid JSON input: {exc}", {}), ensure_ascii=False))
        return 0

    provider = payload.get("provider") or "python"
    request = payload.get("request") or {}

    if provider in ("python", "yfinance"):
        result = yfinance_provider(request)
    elif provider == "tushare":
        result = tushare_provider(request)
    elif provider == "edgartools":
        result = edgartools_provider(request)
    elif provider in ("akshare", "baostock"):
        result = local_cn_provider(provider, request)
    else:
        result = unavailable(provider, f"Unsupported Python finance provider: {provider}", request)

    print(json.dumps(result, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
