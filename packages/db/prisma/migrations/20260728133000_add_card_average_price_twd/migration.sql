-- 多來源平均價：讓 Card 可保存各來源最新有效台幣價的平均結果
ALTER TABLE "Card" ADD COLUMN "averagePriceTwd" DOUBLE PRECISION;
ALTER TABLE "Card" ADD COLUMN "averagePriceSourceCount" INTEGER NOT NULL DEFAULT 0;
