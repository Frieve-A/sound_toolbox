window.soundABXConfig = {
  resetResultsOnConfigChange: true,
  text: {
    sampleRate: sampleRate => `Audio device sample rate: ${sampleRate} Hz`,
    dropAudioFile: "Please drop an audio file.",
    invalidConfig: "Invalid configuration. Please check your inputs.",
    progress: (current, total) => `Test ${current} / ${total}`,
    abprefListening: btn => "You are currently listening to " + btn,
    abxListening: btn => "You are currently listening to " + btn,
    audioPlaybackError: "Error playing audio",
    anonymous: "Anonymous",
    abprefResultTitle: (name, percent) => `${name} scored ${percent}% on A/B Preference Test!`,
    abxResultTitle: (name, percent) => `${name} scored ${percent}% on ABX Test!`,
    correctAnswers: (correct, total) => `Correct answers: ${correct} / ${total}`,
    totalTime: (minutes, seconds) => `Total time to complete the test: ${minutes}:${seconds.toString().padStart(2, "0")}`,
    significantPValue: pValue => `p-value = ${pValue.toFixed(4)} (p < 0.05) → Significant difference`,
    significantConclusion: name => `We can say that ${name} was able to discern the difference.`,
    notSignificantPValue: pValue => `p-value = ${pValue.toFixed(4)} (p > 0.05) → No significant difference`,
    notSignificantConclusion: name => `We cannot say that ${name} was able to discern the difference.`,
    copySuccess: "The result has been copied to your clipboard!",
    copyFailure: "Failed to copy result."
  }
};
