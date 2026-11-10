"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Dictation through the browser's built-in speech recognition (Web Speech API).
 *
 * Privacy: the browser decides where speech is recognised. When the browser
 * offers on-device recognition for the language, this asks for it. Otherwise
 * the audio goes to the browser vendor's speech service (Google for Chrome,
 * Apple for Safari), outside Blackthorn's encryption.
 */

type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative };
type RecognitionEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
};
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = {
  new (): Recognition;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in the browser to dictate.",
  "service-not-allowed": "Dictation is not allowed in this browser.",
  "audio-capture": "No microphone was found.",
  network: "Dictation needs a connection to the browser's speech service.",
  "language-not-supported": "Dictation does not support this language.",
};

export function useDictation(onText: (finalText: string, interimText: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onDevice, setOnDevice] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  const supported = recognitionConstructor() !== null;

  useEffect(() => {
    onTextRef.current = onText;
  });
  useEffect(() => () => recognitionRef.current?.abort(), []);

  async function start() {
    const Constructor = recognitionConstructor();
    if (!Constructor || recognitionRef.current) return;
    setError(null);

    const recognition = new Constructor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    // Keep the audio on the device when the browser can.
    let local = false;
    try {
      const status = await Constructor.available?.({
        langs: [recognition.lang],
        processLocally: true,
      });
      if (status === "available") {
        recognition.processLocally = true;
        local = true;
      }
    } catch {
      // Older browsers: no on-device option.
    }
    setOnDevice(local);

    let finalText = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      onTextRef.current(finalText, interim);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      setError(ERRORS[event.error] ?? "Dictation stopped unexpectedly.");
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setError("Dictation could not start.");
    }
  }

  function stop() {
    recognitionRef.current?.stop();
  }

  return { supported, listening, error, onDevice, start, stop };
}
