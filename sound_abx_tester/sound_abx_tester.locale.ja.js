window.soundABXConfig = {
  resetResultsOnConfigChange: false,
  text: {
    sampleRate: sampleRate => `オーディオデバイスのサンプリングレート: ${sampleRate} Hz`,
    dropAudioFile: "音声ファイルをドロップしてください。",
    invalidConfig: "設定に不備があります。入力内容をご確認ください。",
    progress: (current, total) => `テスト ${current} / ${total}`,
    abprefListening: btn => btn === "A" ? "Aを再生しています" : "Bを再生しています",
    abxListening: btn => `${btn}を再生しています`,
    audioPlaybackError: "オーディオの再生中にエラーが発生しました",
    anonymous: "匿名",
    abprefResultTitle: (name, percent) => `${name} さんのA/B比較テスト正解率: ${percent}%`,
    abxResultTitle: (name, percent) => `${name} さんのABXテスト正解率: ${percent}%`,
    correctAnswers: (correct, total) => `正解数: ${correct} / ${total}`,
    totalTime: (minutes, seconds) => `テスト完了までの時間: ${minutes}:${seconds.toString().padStart(2, "0")}`,
    significantPValue: pValue => `p値 = ${pValue.toFixed(4)} (p < 0.05) → 有意差があります`,
    significantConclusion: name => `${name} さんは音の違いを聞き分けられたと言えます。`,
    notSignificantPValue: pValue => `p値 = ${pValue.toFixed(4)} (p > 0.05) → 有意差はありません`,
    notSignificantConclusion: name => `${name} さんが音の違いを聞き分けられたとは言えません。`,
    copySuccess: "結果をクリップボードにコピーしました！",
    copyFailure: "結果のコピーに失敗しました。"
  }
};
