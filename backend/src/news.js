function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function labelFromScore(score) {
  if (score >= 0.15) return "positive";
  if (score <= -0.15) return "negative";
  return "mixed";
}

export async function fetchTickerNewsSentiment(ticker, apiKey, limit = 6) {
  if (!apiKey) {
    return {
      articles: [],
      aggregate: null,
      skipped: true,
      reason: "ALPHA_VANTAGE_API_KEY is not configured",
    };
  }

  const url =
    `https://www.alphavantage.co/query?function=NEWS_SENTIMENT` +
    `&tickers=${encodeURIComponent(ticker)}` +
    `&limit=${encodeURIComponent(limit)}` +
    `&sort=LATEST` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Alpha Vantage news request failed (${resp.status})`);
  }

  const payload = await resp.json();
  if (payload?.Information || payload?.Note || payload?.ErrorMessage) {
    throw new Error(payload.Information || payload.Note || payload.ErrorMessage);
  }

  const feed = Array.isArray(payload?.feed) ? payload.feed : [];
  const articles = feed.slice(0, limit).map((item) => {
    const sentimentScore = Number(item?.overall_sentiment_score || 0);
    const tickerSentiment = Array.isArray(item?.ticker_sentiment)
      ? item.ticker_sentiment.find((entry) => String(entry?.ticker || "").toUpperCase() === ticker)
      : null;

    const relevantScore = Number(
      tickerSentiment?.ticker_sentiment_score || item?.relevance_score || 0
    );

    return {
      title: item?.title || "Untitled article",
      url: item?.url || "",
      source: item?.source || "Unknown source",
      publishedAt: item?.time_published || null,
      summary: item?.summary || "",
      sentimentScore: Number(sentimentScore.toFixed(3)),
      sentimentLabel: item?.overall_sentiment_label || labelFromScore(sentimentScore),
      relevanceScore: Number(relevantScore.toFixed(3)),
    };
  });

  const scores = articles.map((article) => article.sentimentScore);
  const avgScore = Number(average(scores).toFixed(3));
  const positiveCount = articles.filter((article) => article.sentimentScore > 0.15).length;
  const negativeCount = articles.filter((article) => article.sentimentScore < -0.15).length;
  const neutralCount = articles.length - positiveCount - negativeCount;

  return {
    articles,
    aggregate: articles.length
      ? {
          label: labelFromScore(avgScore),
          averageScore: avgScore,
          articleCount: articles.length,
          positiveCount,
          neutralCount,
          negativeCount,
        }
      : null,
    skipped: false,
    reason: null,
  };
}
