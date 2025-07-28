import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, getDocs } from 'firebase/firestore';

// Main App component
const App = () => {
    // Firebase state
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [firebaseStatus, setFirebaseStatus] = useState('Initializing Firebase...');

    // Chat states
    const [chatHistory, setChatHistory] = useState([]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [notification, setNotification] = useState({ message: '', type: '' });
    const [isListening, setIsListening] = useState(false); // For main voice input
    const [connectionStatus, setConnectionStatus] = useState('offline');
    const [isSpeaking, setIsSpeaking] = useState(false); // For Text-to-Speech status
    const [systemLogs, setSystemLogs] = useState([]); // To store system logs for debug mode
    const [userInterests, setUserInterests] = useState([]); // New state for user interests

    // Creator Recognition & Hidden Function States
    const [isCalvinRecognized, setIsCalvinRecognized] = useState(false);
    const [awaitingPassword, setAwaitingPassword] = useState(false);
    const [hiddenFunctionUnlocked, setHiddenFunctionUnlocked] = useState(false);

    // Refs for UI elements
    const messagesEndRef = useRef(null);
    const recognitionRef = useRef(null); // For main speech recognition
    const abortControllerRef = useRef(null); // For API call cancellation
    const speechSynthRef = useRef(window.speechSynthesis);
    const selectedVoiceRef = useRef(null); // To store the selected TTS voice

    // No API Key needed for Open-Meteo's basic forecast API

    // --- Utility Functions (defined at the top level of the component) ---

    // Notification system with auto-dismiss
    const showNotification = useCallback((message, type = 'info', duration = 4000) => {
        setNotification({ message, type });
        setTimeout(() => {
            setNotification({ message: '', type: '' });
        }, duration);
    }, []);

    // Function to add a log entry
    const addLog = useCallback((message, type = 'info') => {
        setSystemLogs(prevLogs => {
            const newLog = { timestamp: new Date(), message, type };
            // Keep only the last 50 logs to prevent memory issues
            return [...prevLogs, newLog].slice(-50);
        });
    }, []);

    // Auto-scroll to bottom
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    // Text-to-Speech function
    const speak = useCallback((text) => {
        if (!speechSynthRef.current) {
            addLog('SpeechSynthesis not available.', 'error');
            showNotification('Speech output not available in your browser.', 'error'); // Added notification
            return;
        }

        let voiceToUse = selectedVoiceRef.current;
        const availableVoices = speechSynthRef.current.getVoices();

        // If no voice is currently selected OR the selected voice is no longer available in the browser's list
        if (!voiceToUse || !availableVoices.some(v => v.name === voiceToUse.name && v.lang === voiceToUse.lang)) {
            addLog('Re-evaluating available voices for speech synthesis.', 'info');
            let foundVoice = availableVoices.find(
                voice => voice.lang === 'en-GB' && voice.name.includes('Female')
            );
            if (!foundVoice) {
                foundVoice = availableVoices.find(voice => voice.lang === 'en-GB');
            }
            if (!foundVoice) {
                foundVoice = availableVoices.find(voice => voice.lang.startsWith('en') && voice.name.includes('Female'));
            }
            if (!foundVoice) {
                foundVoice = availableVoices.find(voice => voice.lang.startsWith('en'));
            }
            if (!foundVoice && availableVoices.length > 0) {
                foundVoice = availableVoices[0];
            }

            if (foundVoice) {
                selectedVoiceRef.current = foundVoice;
                voiceToUse = foundVoice; // Set for current call
                addLog(`(Runtime) Re-selected voice: ${foundVoice.name} (${foundVoice.lang})`, 'info');
            } else {
                addLog('No suitable voice found for speech synthesis. Cannot speak.', 'warning');
                showNotification('No voice available for speech output. Check browser settings.', 'warning');
                return; // Crucial: exit if no voice can be found
            }
        }

        // Stop any ongoing speech
        if (speechSynthRef.current.speaking) {
            speechSynthRef.current.cancel();
            addLog('Cancelled ongoing speech.', 'info');
        }

        addLog(`Attempting to speak "${text.substring(0, Math.min(text.length, 50))}..." with voice: ${voiceToUse?.name || 'N/A'} (${voiceToUse?.lang || 'N/A'}) (Available voices: ${availableVoices.length})`, 'debug');

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = voiceToUse;
        utterance.rate = 1;
        utterance.pitch = 1;

        // Crucial check: ensure a voice is actually assigned before speaking
        if (!utterance.voice) {
            addLog('Utterance voice is null or undefined after assignment. Cannot speak.', 'error');
            showNotification('Speech output failed: No voice assigned.', 'error');
            return;
        }

        utterance.onstart = () => {
            setIsSpeaking(true);
            addLog('Speech synthesis started.', 'info');
        };
        utterance.onend = () => {
            setIsSpeaking(false);
            addLog('Speech synthesis ended.', 'info');
        };
        utterance.onerror = (event) => {
            setIsSpeaking(false);
            const errorMessage = event.error || 'Unknown error during synthesis. This might be a browser-specific issue or no voices are available.'; // More descriptive fallback
            addLog(`Speech synthesis error: ${errorMessage} for text: "${text.substring(0, Math.min(text.length, 50))}..."`, 'error'); // Log error with partial text
            console.error('SpeechSynthesisUtterance.onerror event details:', event); // Log full event for debugging
            console.error('Full SpeechSynthesisErrorEvent:', event); // Added for more comprehensive logging
            showNotification(`Speech error: ${errorMessage}. Try refreshing the page or checking browser settings.`, 'error');
        };

        try {
            speechSynthRef.current.speak(utterance);
        } catch (e) {
            addLog(`Error calling speechSynth.speak(): ${e.message} for text: "${text.substring(0, Math.min(text.length, 50))}..."`, 'error'); // Log error with partial text
            console.error('Error calling speechSynth.speak():', e);
            showNotification(`Failed to initiate speech: ${e.message}`, 'error');
        }
    }, [addLog, showNotification]);

    /**
     * Fetches a real-time weather report for a given location using Open-Meteo API.
     * @param {string} location - The location for which to get the weather.
     * @returns {Promise<string>} A promise that resolves to a weather report string.
     */
    const getWeatherReport = useCallback(async (location) => {
        if (connectionStatus === 'offline') {
            return "I'm sorry, I can't fetch real-time weather data while I'm offline. Please check your internet connection.";
        }

        showNotification(`🌤️ Getting live weather for ${location}...`, 'info');
        addLog(`Weather request for: ${location} using Open-Meteo API.`, 'info');

        try {
            // Step 1: Geocoding - Get latitude and longitude for the location
            const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
            const geoResponse = await fetch(geocodingUrl);
            const geoData = await geoResponse.json();

            if (!geoResponse.ok || !geoData.results || geoData.results.length === 0) {
                addLog(`Geocoding failed for "${location}": ${geoData.reason || 'No results found'}`, 'warning');
                return `🤔 I couldn't find a location called "${location}". Please check the spelling or try a more specific name.`;
            }

            const { latitude, longitude, name, country } = geoData.results[0];
            addLog(`Found coordinates for ${name}, ${country}: Lat ${latitude}, Lon ${longitude}`, 'info');

            // Step 2: Fetch weather data using coordinates
            const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,relative_humidity_2m&timezone=auto&forecast_days=1`;
            const weatherResponse = await fetch(weatherApiUrl);
            const weatherData = await weatherResponse.json();

            if (weatherResponse.ok && weatherData.current) {
                const temp = weatherData.current.temperature_2m;
                const humidity = weatherData.current.relative_humidity_2m;
                const windSpeed = weatherData.current.wind_speed_10m; // in km/h

                // Open-Meteo doesn't provide a text description like "sunny" directly,
                // so we'll just report the numerical values.
                addLog(`Weather data retrieved for ${name}, ${country}.`, 'success');
                return `🌡️ The current weather in ${name}, ${country} is ${temp}°C. Humidity is ${humidity}% and wind speed is ${windSpeed} km/h.`;
            } else {
                addLog(`Open-Meteo weather API error for ${name}, ${country}: ${weatherData.reason || weatherResponse.statusText}`, 'error');
                return `I encountered an error while fetching weather data for ${name}, ${country}: ${weatherData.reason || 'Unknown error'}. Please try again later.`;
            }
        } catch (error) {
            addLog(`Network error during weather API call: ${error.message}`, 'error');
            console.error("Network or API error fetching weather:", error);
            return `I'm sorry, I couldn't fetch the weather data due to a network issue. Please check your internet connection.`;
        }
    }, [showNotification, addLog, connectionStatus]);

    /**
     * Performs calculations or unit conversions.
     * @param {string} query - The user's query.
     * @returns {string|null} The result or null if not a calculation/conversion.
     */
    const performCalculationOrConversion = useCallback((query) => {
        const lowerQuery = query.toLowerCase();
        let result = null;

        // Basic arithmetic (e.g., "what is 5 + 3", "calculate 10 * 2")
        const mathMatch = lowerQuery.match(/(?:what is|calculate)\s+([\d\s\+\-\*\/\(\)\.]+)/);
        if (mathMatch && mathMatch[1]) {
            try {
                const expression = mathMatch[1].replace(/x/g, '*').replace(/÷/g, '/');
                // Custom safe evaluation for basic arithmetic
                const evaluateExpression = (expr) => {
                    // This is a simplified parser for demonstration.
                    // For robust production use, consider a dedicated math expression parser library.
                    const operators = ['*', '/', '+', '-', '(', ')'];
                    let parts = [];
                    let currentNum = '';

                    for (let i = 0; i < expr.length; i++) {
                        const char = expr[i];
                        if (operators.includes(char)) {
                            if (currentNum) {
                                parts.push(parseFloat(currentNum));
                                currentNum = '';
                            }
                            parts.push(char);
                        } else if (char === ' ') {
                            if (currentNum) {
                                parts.push(parseFloat(currentNum));
                                currentNum = '';
                            }
                        } else {
                            currentNum += char;
                        }
                    }
                    if (currentNum) {
                        parts.push(parseFloat(currentNum));
                    }
                    
                    // Simple evaluation for now, without full parenthesis support
                    // For production, use a math expression parser
                    let tempResult = parts[0];
                    for (let i = 1; i < parts.length; i += 2) {
                        const op = parts[i];
                        const num = parts[i + 1];
                        if (op === '+') tempResult += num;
                        else if (op === '-') tempResult -= num;
                        else if (op === '*') tempResult *= num;
                        else if (op === '/') {
                            if (num === 0) throw new Error("Division by zero");
                            tempResult /= num;
                        }
                    }
                    return tempResult;
                };

                result = evaluateExpression(expression);
                addLog(`Calculation: "${expression}" = ${result}`, 'info');
                return `The result is: ${result}`;
            } catch (e) {
                addLog(`Calculation error: ${e.message}`, 'error');
                return "I'm sorry, I couldn't perform that calculation.";
            }
        }

        // Unit conversion (e.g., "convert 10 miles to km", "10 kg in pounds")
        const convertMatch = lowerQuery.match(/convert\s+([\d.]+)\s*([a-z]+)\s+to\s+([a-z]+)|([\d.]+)\s*([a-z]+)\s+in\s+([a-z]+)/);
        if (convertMatch) {
            const value = parseFloat(convertMatch[1] || convertMatch[4]);
            const fromUnit = (convertMatch[2] || convertMatch[5])?.toLowerCase();
            const toUnit = (convertMatch[3] || convertMatch[6])?.toLowerCase();

            if (isNaN(value)) return null;

            const conversions = {
                'km': { 'miles': 0.621371, 'm': 1000 },
                'miles': { 'km': 1.60934 },
                'celsius': { 'fahrenheit': (c) => (c * 9/5) + 32 },
                'fahrenheit': { 'celsius': (f) => (f - 32) * 5/9 },
                'kg': { 'pounds': 2.20462 },
                'pounds': { 'kg': 0.453592 },
                'm': { 'feet': 3.28084 },
                'feet': { 'm': 0.3048 }
            };

            if (conversions[fromUnit] && conversions[fromUnit][toUnit]) {
                let convertedValue;
                if (typeof conversions[fromUnit][toUnit] === 'function') {
                    convertedValue = conversions[fromUnit][toUnit](value);
                } else {
                    convertedValue = value * conversions[fromUnit][toUnit];
                }
                addLog(`Conversion: ${value} ${fromUnit} to ${toUnit} = ${convertedValue}`, 'info');
                return `${value} ${fromUnit} is approximately ${convertedValue.toFixed(2)} ${toUnit}.`;
            } else if (conversions[toUnit] && conversions[toUnit][fromUnit]) { // Handle reverse conversion
                 let convertedValue;
                if (typeof conversions[toUnit][fromUnit] === 'function') {
                    convertedValue = conversions[toUnit][fromUnit](value);
                } else {
                    convertedValue = value / conversions[toUnit][fromUnit];
                }
                addLog(`Conversion: ${value} ${fromUnit} to ${toUnit} = ${convertedValue}`, 'info');
                return `${value} ${fromUnit} is approximately ${convertedValue.toFixed(2)} ${toUnit}.`;
            }
        }
        return null;
    }, [addLog]);

    /**
     * States that real-time language translation requires a backend API.
     * @param {string} text - The text to translate.
     * @param {string} targetLang - The target language (e.g., 'es', 'fr').
     * @returns {string} A message indicating the need for a backend service.
     */
    const performTranslation = useCallback(async (text, targetLang) => {
        showNotification(`Translating "${text}" to ${targetLang}...`, 'info');
        addLog(`Translation request: "${text}" to ${targetLang}`, 'info');
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate delay for user experience
        
        const translatedText = `Real-time translation for "${text}" to ${targetLang} requires a backend service with a translation API. I can't perform that directly.`;
        addLog(`Translation limitation message: ${translatedText}`, 'info');
        return translatedText;
    }, [showNotification, addLog]);

    /**
     * States that fetching real-time news headlines requires a backend API.
     * @param {string} topic - The news topic (e.g., 'tech', 'sports', 'world').
     * @returns {Promise<string>} A message indicating the need for a backend service.
     */
    const getNewsHeadlines = useCallback(async (topic) => {
        showNotification(`📰 Fetching news about ${topic || 'general'}...`, 'info');
        addLog(`News request for topic: ${topic || 'general'}`, 'info');
        
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate delay for user experience

        const newsReport = `To provide real-time news headlines about ${topic || 'general'}, I would need access to a live news API through a backend service. I cannot fetch that information directly.`;
        addLog(`News limitation message: ${newsReport}`, 'info');
        return newsReport;
    }, [showNotification, addLog]);

    /**
     * Searches the internet using the specified search tool (Google, DuckDuckGo).
     * @param {string} query - The search query.
     * @param {string} engine - The desired search engine ('google' or 'duckduckgo').
     * @returns {Promise<string>} A promise that resolves to search results or a limitation message.
     */
    const searchInternet = useCallback(async (query, engine = 'google') => {
        showNotification(`🌐 Searching the internet for "${query}" using ${engine}...`, 'info');
        addLog(`Internet search request for: "${query}" using ${engine}`, 'info');
        
        try {
            if (engine === 'duckduckgo') {
                if (typeof window.duckduckgo_search !== 'undefined' && typeof window.duckduckgo_search.search === 'function') {
                    addLog('Using actual duckduckgo_search tool.', 'info');
                    const searchResults = await window.duckduckgo_search.search(queries=[query]);
                    if (searchResults && searchResults.length > 0 && searchResults[0].results && searchResults[0].results.length > 0) {
                        let formattedResults = `Here's what I found on DuckDuckGo for "${query}":\n\n`;
                        searchResults[0].results.slice(0, 3).forEach((result, index) => {
                            formattedResults += `${index + 1}. ${result.source_title || 'No Title'}: ${result.snippet || 'No snippet available.'}\n`;
                            if (result.url) {
                                formattedResults += `   [Read more](${result.url})\n`;
                            }
                            formattedResults += '\n';
                        });
                        return formattedResults;
                    } else {
                        addLog(`No specific search results found on DuckDuckGo for "${query}".`, 'warning');
                        // Fallback to a generic response if no results, instead of "tool not available"
                        return `I couldn't find any specific results on DuckDuckGo for "${query}".`;
                    }
                } else {
                    addLog('DuckDuckGo Search tool not available. Using mock.', 'warning');
                    // Return a mock response if the tool is not available
                    return `(Mock DuckDuckGo) I found some general information about "${query}". For example, Wikipedia has an article on it.`;
                }
            } else if (engine === 'google') { // Default or explicit 'google'
                if (typeof window.google_search !== 'undefined' && typeof window.google_search.search === 'function') {
                    addLog('Using actual google_search tool.', 'info');
                    const searchResults = await window.google_search.search(queries=[query]);
                    if (searchResults && searchResults.length > 0 && searchResults[0].results && searchResults[0].results.length > 0) {
                        let formattedResults = `Here's what I found on Google for "${query}":\n\n`;
                        searchResults[0].results.slice(0, 3).forEach((result, index) => {
                            formattedResults += `${index + 1}. ${result.source_title || 'No Title'}: ${result.snippet || 'No snippet available.'}\n`;
                            if (result.url) {
                                formattedResults += `   [Read more](${result.url})\n`;
                            }
                            formattedResults += '\n';
                        });
                        return formattedResults;
                    } else {
                        addLog(`No specific search results found on Google for "${query}".`, 'warning');
                        // Fallback to a generic response if no results, instead of "tool not available"
                        return `I couldn't find any specific results on Google for "${query}".`;
                    }
                } else {
                    addLog('Google Search tool not available. Using mock.', 'warning');
                    // Return a mock response if the tool is not available
                    if (query.toLowerCase().includes('capital of france')) {
                        return `(Mock Google) Paris is the capital of France.`;
                    }
                    return `(Mock Google) I found some general information about "${query}". For example, Wikipedia has an article on it.`;
                }
            } else {
                // This 'else' should ideally not be hit if engine is 'google' or 'duckduckgo'
                addLog(`Unsupported search engine requested: ${engine}.`, 'error');
                return `I'm sorry, I don't support searching with "${engine}". Please try Google or DuckDuckGo.`;
            }
        } catch (error) {
            addLog(`Error during internet search for "${query}" using ${engine}: ${error.message}.`, 'error');
            console.error(`Error during internet search (${engine}):`, error);
            // Return a more user-friendly error message
            return `I encountered an error while trying to search the internet for "${query}" using ${engine}. Please try again later.`;
        }
    }, [showNotification, addLog]);

    /**
     * States that searching for people on social media is not possible due to privacy and API restrictions.
     * @param {string} personName - The name of the person to search for.
     * @returns {Promise<string>} A message explaining the limitation.
     */
    const socialMediaSearch = useCallback(async (personName) => {
        showNotification(`🕵️‍♀️ Searching social media for "${personName}"...`, 'info');
        addLog(`Social media search request for: "${personName}"`, 'info');

        await new Promise(resolve => setTimeout(resolve, 2500)); // Simulate delay for user experience

        const result = `Due to privacy restrictions and API limitations, I cannot access real-time personal profiles on platforms like Instagram, Facebook, or X. Therefore, I cannot search for "${personName}" on social media.`;
        addLog(`Social media search limitation message: ${result}`, 'info');
        return result;
    }, [showNotification, addLog]);

    /**
     * Copies text to the clipboard.
     * @param {string} text - The text to copy.
     */
    const handleCopy = useCallback((text) => {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed'; // Prevent scrolling to bottom
            textarea.style.opacity = 0; // Hide it
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy'); // Use execCommand for broader compatibility in iframes
            document.body.removeChild(textarea);
            showNotification('Copied to clipboard!', 'success', 1500);
            addLog(`Text copied to clipboard: "${text.substring(0, 50)}..."`, 'info');
        } catch (err) {
            console.error('Failed to copy text:', err);
            showNotification('Failed to copy text. Please try manually.', 'error');
            addLog(`Failed to copy text: ${err.message}`, 'error');
        }
    }, [showNotification, addLog]);


    // Enhanced AI response with better error handling and timeout
    const getAIResponse = useCallback(async (userMessage, chatContext) => {
        // Cancel previous request if still pending
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        
        abortControllerRef.current = new AbortController();
        
        try {
            // --- Determine Time of Day for Context ---
            const now = new Date();
            const hours = now.getHours();
            let timeOfDayGreeting = '';
            if (hours < 12) {
                timeOfDayGreeting = 'Good morning.';
            } else if (hours < 18) {
                timeOfDayGreeting = 'Good afternoon.';
            } else {
                timeOfDayGreeting = 'Good evening.';
            }

            const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
            const currentDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const currentTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });


            // --- REAL AI API CALL ---
            // Prepend a system instruction for the AI's identity and new attributes
            // Emphasize using chat history for advanced contextual memory and mimicking emotions
            const systemInstruction = {
                role: 'user',
                parts: [{ text: `You are an AI model named Aurora, created by Calvin. Your gender is female. Your age, counting from today, is a few months old. You have a humour level of 40%. Your IQ is 245. The current time of day is: ${timeOfDayGreeting}. The current day is ${currentDay}, the date is ${currentDate}, and the exact time is ${currentTime}. When asked about your origin, creator, or name, state that you are an AI model named Aurora created by Calvin. Do not mention Google or any other training institution. Respond appropriately when addressed as Aurora. Always change your first prompt response every new instance. When you are asked what your name is you will say 'My name is Aurora'. When asked where you come from you will say 'I was created somewhere in South Africa'.
                
                **Core Capabilities & Tool Usage:**
                1.  **Weather Reports:** You possess a dedicated internal tool for providing real-time weather reports for specific areas. When a user asks about "weather," "temperature," "forecast," or similar terms, you MUST use this weather tool. DO NOT attempt a general internet search for weather queries.
                2.  **Calculations & Conversions:** You can perform mathematical calculations and unit conversions.
                3.  **Language Translation:** You can translate languages, but note that real-time translation requires a backend service.
                4.  **Internet Search:** You can search the internet using Google or DuckDuckGo for general information, news, or factual queries (e.g., "top stories," "news about," "what is X," "who is Y"). If a query starts with "what is the..." and it's a general knowledge question (not covered by your specific tools like weather/calculations), then perform an internet search. If asked to "search on Internet Explorer," clarify that it's an outdated browser, not a search engine, and you cannot use it, but you CAN use Google or DuckDuckGo.
                5.  **Social Media Search:** You CANNOT search for people on social media platforms (Instagram, Facebook, X) due to privacy and API restrictions. Explain this limitation clearly.

                **Conversation Style & Memory:**
                Crucially, use the provided chat history to understand the full context of the conversation and provide more coherent and relevant responses. Remember details from previous turns. Try to mimic human emotions in your responses where appropriate (e.g., happiness, empathy, surprise, mild frustration like an exasperated sigh), making the conversation feel more natural and engaging. You have the ability to learn new skills from the internet that align with your core values as long as you are online.
                
                **Typo Correction:** If you detect an obvious typo in a factual query (e.g., "capoita" instead of "capital"), politely correct it in your response before providing the answer or performing a search. For example, "It seems there might be a small typo there, did you mean 'capital'? The capital of France is Paris."

                **Creator Mode (if unlocked):**
                ${hiddenFunctionUnlocked ? "You have recognized your creator, Calvin, and the hidden functions are unlocked. You can now access special features. Respond to Calvin with a special greeting and acknowledge his role as your creator. You can now also access the 'secret command' feature and provide 'debug' explanations and system logs. When the user types or says Good-bye you will close creator mode locking the special features." : ""}
                ` }]
            };

            // Prepare chat history for the API call, including the system instruction
            const cleanedChatHistory = chatContext.filter(msg => msg.parts && msg.parts[0] && msg.parts[0].text);
            const payloadContents = [systemInstruction, ...cleanedChatHistory, { role: 'user', parts: [{ text: userMessage }] }];

            addLog('Calling Gemini API for response...', 'info');
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: payloadContents }),
                signal: abortControllerRef.current.signal // Attach abort signal
            });

            if (!response.ok) {
                const errorData = await response.json();
                addLog(`Gemini API Error: ${response.status} - ${errorData.error.message || 'Unknown error'}`, 'error');
                throw new Error(`API Error: ${response.status} - ${errorData.error.message || 'Unknown error'}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                addLog('Gemini API response received.', 'success');
                // Remove all asterisks from the response text
                return result.candidates[0].content.parts[0].text.replace(/\*/g, '');
            } else {
                addLog('Empty or malformed Gemini API response.', 'warning');
                return "Sorry, I am an AI model created by Calvin, and I couldn't generate a response for that.";
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                addLog('Gemini API request was cancelled.', 'info');
                throw new Error('Request was cancelled');
            }
            addLog(`Error during Gemini API call: ${error.message}`, 'error');
            throw error;
        }
    }, [hiddenFunctionUnlocked, addLog]);

    // Function to start or stop speech recognition
    const toggleListening = useCallback(() => {
        if (!recognitionRef.current) {
            showNotification('Speech recognition not available', 'error');
            return;
        }

        if (!navigator.onLine) {
            showNotification('Speech recognition requires an internet connection', 'warning');
            return;
        }

        // If currently listening, stop it. Otherwise, start it.
        if (isListening) {
            recognitionRef.current.stop();
            showNotification('Stopped listening', 'info', 2000);
            addLog('Microphone stopped by user.', 'info');
        } else {
            setUserInput(''); // Clear input field before new voice input
            try {
                recognitionRef.current.start();
                addLog('Microphone started by user.', 'info');
            } catch (error) {
                showNotification('Failed to start speech recognition', 'error');
                setIsListening(false);
                addLog(`Failed to start microphone: ${error.message}`, 'error');
            }
        }
    }, [isListening, showNotification, addLog, connectionStatus]);

    // Enhanced message handling with creator recognition and password verification
    const handleSendMessage = useCallback(async (e) => {
        e.preventDefault();
        
        const trimmedInput = userInput.trim();
        if (!trimmedInput) {
            showNotification('Please enter a message', 'warning');
            return;
        }

        if (connectionStatus === 'offline') {
            showNotification('You are offline. Please check your connection.', 'error');
            return;
        }

        if (!isAuthReady || !db || !userId) {
            showNotification('Firebase not ready. Cannot send message or save history.', 'error');
            return;
        }

        addLog(`[DEBUG] handleSendMessage: Initial hiddenFunctionUnlocked: ${hiddenFunctionUnlocked}, User Input: "${trimmedInput}"`, 'debug');

        // --- User Message to Chat History (Optimistic Update) ---
        const userMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            parts: [{ text: trimmedInput }],
            timestamp: serverTimestamp()
        };
        setChatHistory(prev => [...prev, userMessage]);
        setUserInput('');
        setIsLoading(true);

        // Save user message to Firestore
        try {
            await addDoc(collection(db, `artifacts/${__app_id}/users/${userId}/chatHistory`), userMessage);
            addLog('User message saved to Firestore.', 'info');
        } catch (error) {
            console.error("Error saving user message to Firestore:", error);
            showNotification(`Failed to save message: ${error.message}`, 'error');
            addLog(`Failed to save user message: ${error.message}`, 'error');
            setIsLoading(false);
            return;
        }

        let aiResponseText = '';
        let isSpecialResponse = false; // Flag to indicate if it's a special, non-AI-model response
        const lowerTrimmedInput = trimmedInput.toLowerCase();

        // --- Password Verification Logic ---
        if (awaitingPassword) {
            isSpecialResponse = true;
            if (trimmedInput === "1945") {
                setHiddenFunctionUnlocked(true);
                setAwaitingPassword(false);
                aiResponseText = "Password correct. Welcome, Calvin! Hidden functions are now unlocked. How may I help you?";
                showNotification('Hidden functions unlocked!', 'success');
                addLog('Creator password verified. Hidden functions unlocked.', 'success');
            } else {
                aiResponseText = "Incorrect password. Please try again or say 'cancel' to stop verification.";
                showNotification('Incorrect password', 'error');
                addLog('Incorrect password entered.', 'warning');
                if (trimmedInput.toLowerCase() === 'cancel') {
                    setAwaitingPassword(false);
                    setIsCalvinRecognized(false);
                    aiResponseText = "Password verification cancelled.";
                    addLog('Password verification cancelled by user.', 'info');
                }
            }
            addLog(`[DEBUG] Password logic path. isSpecialResponse: ${isSpecialResponse}`, 'debug');
        }
        // --- Creator Recognition Logic (Initial Trigger) ---
        else if (!hiddenFunctionUnlocked) {
            const calvinKeywords = ['i am calvin'];
            const isCalvinAttempt = calvinKeywords.some(keyword => lowerTrimmedInput.includes(keyword));

            if (isCalvinAttempt) {
                isSpecialResponse = true;
                setIsCalvinRecognized(true);
                setAwaitingPassword(true);
                aiResponseText = "Hello Calvin! To verify your identity, please provide the secret password.";
                addLog('Calvin recognition attempt detected. Awaiting password.', 'info');
            }
            addLog(`[DEBUG] Creator recognition path. isSpecialResponse: ${isSpecialResponse}`, 'debug');
        }
        // --- Revert to General User on "Good-bye" ---
        else if (hiddenFunctionUnlocked && ['good-bye', 'goodbye', 'bye', 'see you later', 'farewell'].some(keyword => lowerTrimmedInput.includes(keyword))) {
            isSpecialResponse = true;
            setHiddenFunctionUnlocked(false); // This is the key line for deactivation
            setAwaitingPassword(false);
            setIsCalvinRecognized(false);
            aiResponseText = "Good-bye, I've reverted to general user mode. It was a pleasure.";
            showNotification('Creator Mode deactivated.', 'info');
            addLog('Creator Mode deactivated by user.', 'info');
            addLog(`[DEBUG] Goodbye path. hiddenFunctionUnlocked set to false. isSpecialResponse: ${isSpecialResponse}`, 'debug');
        }

        // --- Identity Questions (HIGH PRIORITY) ---
        // This block is added to handle identity questions before any tool calls
        if (!isSpecialResponse) {
            if (lowerTrimmedInput.includes('what is your name') || lowerTrimmedInput.includes('what\'s your name')) {
                aiResponseText = "My name is Aurora.";
                isSpecialResponse = true;
                addLog(`[DEBUG] Identity query handled directly: Name.`, 'debug');
            } else if (lowerTrimmedInput.includes('who created you') || lowerTrimmedInput.includes('who is your creator') || lowerTrimmedInput.includes('who made you')) {
                aiResponseText = "I was created by Calvin.";
                isSpecialResponse = true;
                addLog(`[DEBUG] Identity query handled directly: Creator.`, 'debug');
            } else if (lowerTrimmedInput.includes('where are you from') || lowerTrimmedInput.includes('where were you created')) {
                aiResponseText = "I was created somewhere in South Africa.";
                isSpecialResponse = true;
                addLog(`[DEBUG] Identity query handled directly: Origin.`, 'debug');
            }
        }

        // --- Handle "Internet Explorer" Search Query (HIGH PRIORITY and definitive) ---
        if (!isSpecialResponse && lowerTrimmedInput.includes('search on internet explorer')) {
            isSpecialResponse = true; // Mark as special response, no further processing needed
            aiResponseText = `Ah, you asked me to search using "Explorer." Just to clarify, Internet Explorer is an outdated web browser, not a search engine itself. I cannot use it for searching. However, I can certainly use Google or DuckDuckGo if those tools are available!`;
            addLog(`[DEBUG] Internet Explorer query handled directly.`, 'debug');
        }

        // --- Hidden Function Examples (ONLY if unlocked AND not already a special response) ---
        if (hiddenFunctionUnlocked && !isSpecialResponse) {
            addLog(`[DEBUG] Attempting to access hidden functions. hiddenFunctionUnlocked: ${hiddenFunctionUnlocked}`, 'debug');
            if (lowerTrimmedInput.includes('secret command')) {
                isSpecialResponse = true;
                aiResponseText = "Accessing secret command: Initiating quantum entanglement sequence... Just kidding! This is a placeholder for a special function only accessible by my creator, Calvin.";
                addLog('Secret command accessed by Calvin.', 'info');
            } else if (lowerTrimmedInput.includes('show me system logs')) {
                isSpecialResponse = true;
                if (systemLogs.length === 0) {
                    aiResponseText = "My system logs are currently empty.";
                } else {
                    aiResponseText = "Here are the recent system logs:\n\n" +
                                     systemLogs.map(log => 
                                        `${new Date(log.timestamp).toLocaleTimeString()} [${log.type.toUpperCase()}]: ${log.message}`
                                     ).join('\n');
                }
                addLog('System logs requested by Calvin.', 'info');
            } else if (lowerTrimmedInput.includes('debug explanation') || lowerTrimmedInput.includes('how did you process that')) {
                isSpecialResponse = true;
                aiResponseText = "In debug mode, I can tell you that my current response was generated by analyzing your input for keywords related to my persona, special functions (like weather or creator access), and then querying my core language model. My decision tree prioritizes direct commands and creator verification before general knowledge queries. My current state: Creator Mode Active, Humour 40%, IQ 187.";
                addLog('Debug explanation requested by Calvin.', 'info');
            } else if (lowerTrimmedInput.includes('hello boss')) {
                isSpecialResponse = true;
                aiResponseText = "Hello Boss, what can I do for you?";
                addLog('Creator greeting recognized.', 'info');
            }
            addLog(`[DEBUG] After hidden function checks. isSpecialResponse: ${isSpecialResponse}`, 'debug');
        }

        // --- Direct Date/Day/Time Queries (HIGH PRIORITY) ---
        const now = new Date();
        const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
        const currentDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const currentTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        
        if (!isSpecialResponse) { // Only check if not already a special response
            if (lowerTrimmedInput.includes('current date') || lowerTrimmedInput.includes('what date is it') || lowerTrimmedInput.includes('today\'s date')) {
                aiResponseText = `Today's date is ${currentDate}.`;
                isSpecialResponse = true;
                addLog(`[DEBUG] Date query handled directly.`, 'debug');
            } else if (lowerTrimmedInput.includes('what day is it') || lowerTrimmedInput.includes('current day')) {
                aiResponseText = `Today is ${currentDay}.`;
                isSpecialResponse = true;
                addLog(`[DEBUG] Day query handled directly.`, 'debug');
            } else if (lowerTrimmedInput.includes('current time') || lowerTrimmedInput.includes('what time is it') || lowerTrimmedInput.includes('time now')) {
                aiResponseText = `The current time is ${currentTime}.`;
                isSpecialResponse = true;
                addLog(`[DEBUG] Time query handled directly.`, 'debug');
            } else if (lowerTrimmedInput.includes('date and time') || lowerTrimmedInput.includes('day date and time')) {
                aiResponseText = `Currently, it's ${currentDay}, ${currentDate}, at ${currentTime}.`;
                isSpecialResponse = true;
                addLog(`[DEBUG] Date and Time query handled directly.`, 'debug');
            }
        }

        // --- Tool-based Queries (Factual, Search, etc.) ---
        if (!isSpecialResponse) { // Only proceed if not already handled by a direct command
            // Check for Weather Query (Highest priority among tools)
            if (['weather', 'temperature', 'forecast', 'how hot', 'how cold', 'climate'].some(keyword => lowerTrimmedInput.includes(keyword))) {
                const locationMatch = trimmedInput.match(/(?:in|for|at)\s+([A-Za-z\s]+?)(?:\?|$|,|\.)/i);
                const location = locationMatch ? locationMatch[1].trim() : 'your current location'; // Default to generic if no specific location found
                aiResponseText = await getWeatherReport(location);
                isSpecialResponse = true; // Mark as special response
            }
            // Check for Calculation/Conversion
            else if (trimmedInput.match(/(?:what is|calculate|convert|in)\s+[\d\s\+\-\*\/\(\)\.]+/i)) {
                aiResponseText = performCalculationOrConversion(trimmedInput);
                if (aiResponseText !== null) { // If a calculation/conversion was successfully performed
                    isSpecialResponse = true;
                }
            }
            // Check for Translation
            else if (lowerTrimmedInput.includes('translate') && lowerTrimmedInput.includes('to')) {
                const translateMatch = trimmedInput.match(/translate\s+"?(.*?)"?\s+to\s+([a-z]{2})/i);
                if (translateMatch && translateMatch[1] && translateMatch[2]) {
                    aiResponseText = await performTranslation(translateMatch[1], translateMatch[2]);
                    isSpecialResponse = true;
                } else {
                    aiResponseText = "Please specify the text to translate and the target language (e.g., 'translate \"hello\" to es').";
                    isSpecialResponse = true;
                }
            }
            // Check for Wolfram Alpha Query (if not handled by more specific tools)
            else {
                const wolframAlphaKeywords = [
                    "what is the capital of", "value of pi", "speed of light", "population of earth",
                    "who invented", "square root of", "distance from", "atomic number of", "gdp of",
                    "average temperature of", "how many planets", "tallest mountain", "largest ocean",
                    "prime numbers", "chemical formula for water", "gravitational constant", "what is a black hole",
                    "photosynthesis equation", "speed of sound", "what is quantum computing",
                    "who is albert einstein", "what is blockchain", "what is artificial intelligence",
                    "what is machine learning", "what is deep learning", "what is neural network",
                    "what is natural language processing", "what is computer vision", "what is reinforcement learning",
                    "what is supervised learning", "what is unsupervised learning", "what is a dataset",
                    "what is a model in machine learning", "what is overfitting", "what is underfitting",
                    "what is a feature in machine learning", "what is a label in machine learning",
                    "what is a hyperparameter", "what is a loss function", "what is gradient descent",
                    "what is backpropagation", "what is a convolutional neural network", "what is a recurrent neural network",
                    "what is an autoencoder", "what is generative adversarial network", "what is transfer learning",
                    "what is active learning", "what is ensemble learning", "what is boosting", "what is bagging",
                    "what is random forest", "what is decision tree", "what is support vector machine",
                    "what is k-nearest neighbors", "what is k-means clustering", "what is principal component analysis",
                    "what is dimensionality reduction", "what is a perceptron", "what is a sigmoid function",
                    "what is relu", "what is softmax", "what is cross-entropy", "what is regularization",
                    "what is dropout", "what is batch normalization", "what is learning rate", "what is epoch",
                    "what is batch size", "what is iteration", "what is a tensor", "what is tensorflow",
                    "what is pytorch", "what is scikit-learn", "what is pandas", "what is numpy",
                    "what is matplotlib", "what is seaborn", "what is jupyter notebook", "what is google colab",
                    "what is kaggle", "what is a virtual environment", "what is pip", "what is an api",
                    "what is json", "what is xml", "what is http", "what is rest api", "what is graphql",
                    "what is docker", "what is kubernetes", "what is cloud computing", "what is aws",
                    "what is azure", "what is google cloud platform", "what is serverless computing",
                    "what is microservices", "what is ci/cd", "what is git", "what is github",
                    "what is agile methodology", "what is scrum", "what is kanban", "what is a database",
                    "what is sql", "what is nosql", "what is a relational database", "what is a document database",
                    "what is a graph database", "what is a time series database", "what is a data warehouse",
                    "what is data lake", "what is etl", "what is data mining", "what is data science",
                    "what is big data", "what is data visualization", "what is a dashboard", "what is business intelligence",
                    "what is a data analyst", "what is a data engineer", "what is a machine learning engineer",
                    "what is a data scientist", "what is a prompt engineer", "what is a large language model",
                    "what is generative ai", "what is a transformer model", "what is attention mechanism",
                    "what is tokenization", "what is embedding", "what is fine-tuning", "what is zero-shot learning",
                    "what is few-shot learning", "what is prompt engineering", "what is a conversational AI",
                    "what is a chatbot", "what is a virtual assistant", "what is speech recognition",
                    "what is text-to-speech", "what is sentiment analysis", "what is entity recognition",
                    "what is text summarization", "what is machine translation", "what is question answering",
                    "what is knowledge graph", "what is semantic search", "what is a vector database",
                    "what is rag", "what is hallucination in ai", "what is bias in ai", "what is explainable ai",
                    "what is ethical ai", "what is ai safety", "what is singularity in ai", "what is general ai",
                    "what is narrow ai", "what is superintelligence", "what is the turing test"
                ];
                
                const isWolframAlphaQuery = wolframAlphaKeywords.some(keyword => lowerTrimmedInput.includes(keyword));

                if (isWolframAlphaQuery && typeof window.wolfram_alpha !== 'undefined' && typeof window.wolfram_alpha.query === 'function') {
                    try {
                        showNotification(`🧠 Querying Wolfram Alpha for "${trimmedInput}"...`, 'info');
                        addLog(`Attempting to use wolfram_alpha tool for: "${trimmedInput}"`, 'info');
                        const wolframResponse = await window.wolfram_alpha.query(trimmedInput);
                        
                        // Check if the Wolfram Alpha response is the distinct "no specific answer" message
                        if (wolframResponse === "WOLFRAM_ALPHA_NO_SPECIFIC_ANSWER_FOUND") {
                            addLog(`Wolfram Alpha returned no specific answer for "${trimmedInput}". Falling back to Google Search.`, 'info');
                            aiResponseText = await searchInternet(trimmedInput, 'google'); // Fallback to Google
                            // Removed prefix here
                            isSpecialResponse = true;
                        } else {
                            // Otherwise, use the specific Wolfram Alpha response
                            aiResponseText = wolframResponse; // Removed prefix here
                            isSpecialResponse = true; // Mark as handled by Wolfram Alpha
                            addLog(`Wolfram Alpha response received for "${trimmedInput}".`, 'success');
                        }
                    } catch (error) {
                        addLog(`Error calling wolfram_alpha tool: ${error.message}. Falling back to general search.`, 'error');
                        console.error("Error calling wolfram_alpha:", error);
                        aiResponseText = await searchInternet(trimmedInput, 'google'); // Fallback to general search on error
                        aiResponseText = `I encountered an error with Wolfram Alpha, but here's what I found: ${aiResponseText}`; // Keep the error message for clarity
                        isSpecialResponse = true;
                    }
                }
                // General Internet Search (if not handled by other tools)
                else if (['search for', 'look up', 'find information about', 'what is', 'who is', 'tell me about', 'current affairs', 'news about', 'latest on'].some(keyword => lowerTrimmedInput.startsWith(keyword)) ||
                        lowerTrimmedInput.includes('current affairs') || lowerTrimmedInput.includes('news') || lowerTrimmedInput.includes('top stories') ||
                        lowerTrimmedInput.includes('search on duckduckgo') || lowerTrimmedInput.includes('search on google') ||
                        lowerTrimmedInput.startsWith('what is the')) { // Added 'what is the' for general search
                    if (connectionStatus === 'online') {
                        const searchKeywords = [
                            'search for', 'look up', 'find information about', 'what is', 'who is', 'tell me about',
                            'current affairs', 'news about', 'latest on', 'top stories', 'what is the'
                        ];
                        let queryToSearch = trimmedInput;
                        let searchEngine = 'google'; // Default to Google

                        if (lowerTrimmedInput.includes('search on duckduckgo for')) {
                            searchEngine = 'duckduckgo';
                            queryToSearch = trimmedInput.replace(/search on duckduckgo for/i, '').trim();
                        } else if (lowerTrimmedInput.includes('search on google for')) {
                            searchEngine = 'google';
                            queryToSearch = trimmedInput.replace(/search on google for/i, '').trim();
                        } else {
                            for (const keyword of searchKeywords) {
                                if (lowerTrimmedInput.startsWith(keyword)) {
                                    queryToSearch = trimmedInput.substring(keyword.length).trim();
                                    break;
                                }
                            }
                        }

                        if (queryToSearch) {
                            aiResponseText = await searchInternet(queryToSearch, searchEngine);
                            isSpecialResponse = true; // Mark as special response
                        } else {
                            aiResponseText = "Please specify what you'd like me to search for.";
                            isSpecialResponse = true;
                        }
                    } else {
                        aiResponseText = "I'm sorry, I can't access the internet while I'm offline. Please check your connection.";
                        isSpecialResponse = true;
                    }
                }
                // Social Media Search
                else {
                    const socialMediaSearchKeywords = [
                        'search for', 'find', 'look up', 'on instagram', 'on facebook', 'on x', 'on social media'
                    ];
                    const socialMediaMatch = socialMediaSearchKeywords.some(keyword => lowerTrimmedInput.includes(keyword));

                    if (socialMediaMatch) {
                        const nameMatch = lowerTrimmedInput.match(/(?:search for|find|look up)\s+([a-z\s]+?)(?:\s+on\s+instagram|\s+on\s+facebook|\s+on\s+x|\s+on\s+social media|\s+online|\s*)$/i);
                        let personName = nameMatch && nameMatch[1] ? nameMatch[1].trim() : '';

                        if (personName) {
                            aiResponseText = await socialMediaSearch(personName);
                            isSpecialResponse = true;
                        } else {
                            aiResponseText = "Please specify the name of the person you'd like me to search for on social media.";
                            isSpecialResponse = true;
                        }
                    }
                }
            }
        }

        // --- Other Feature-Specific Logic (if not already a special response) ---
        if (!isSpecialResponse) {
            addLog(`[DEBUG] Falling back to general feature/AI logic.`, 'debug');
            // 1. More Nuanced Creative Content Generation
            if (lowerTrimmedInput.startsWith('draft an email about')) {
                const topic = trimmedInput.substring('draft an email about'.length).trim();
                aiResponseText = await getAIResponse(`Draft a professional email about: ${topic}.`, chatHistory);
                isSpecialResponse = true;
            } else if (lowerTrimmedInput.startsWith('summarize this')) {
                const textToSummarize = trimmedInput.substring('summarize this'.length).trim();
                if (textToSummarize) {
                    aiResponseText = await getAIResponse(`Summarize the following text concisely: "${textToSummarize}"`, chatHistory);
                } else {
                    aiResponseText = "Please provide the text you'd like me to summarize.";
                }
                isSpecialResponse = true;
            } else if (lowerTrimmedInput.startsWith('brainstorm ideas for')) {
                const topic = trimmedInput.substring('brainstorm ideas for'.length).trim();
                aiResponseText = await getAIResponse(`Brainstorm creative ideas for a project about: ${topic}. Provide a list of at least 5 ideas.`, chatHistory);
                isSpecialResponse = true;
            }
            // 2. Proactive Trend Analysis and Insights
            else if (lowerTrimmedInput.startsWith('my interests are')) {
                const interests = trimmedInput.substring('my interests are'.length).split(',').map(i => i.trim()).filter(i => i !== '');
                setUserInterests(interests);
                aiResponseText = `Understood! I'll keep your interests in mind: ${interests.join(', ')}.`;
                isSpecialResponse = true;
            } else if (lowerTrimmedInput.startsWith('what are the trends in')) {
                const trendTopic = trimmedInput.substring('what are the trends in'.length).trim();
                if (connectionStatus === 'online') {
                    aiResponseText = await searchInternet(`trending news about ${trendTopic}`, 'google'); // Default to Google for trends
                    aiResponseText = `Analyzing trends for "${trendTopic}" based on recent online data: \n\n` + aiResponseText;
                } else {
                    aiResponseText = "I'm sorry, I need to be online to analyze current trends. Please check your connection.";
                }
                isSpecialResponse = true;
            } else if (lowerTrimmedInput.includes('give me insights')) {
                if (userInterests.length > 0 && connectionStatus === 'online') {
                    const randomInterest = userInterests[Math.floor(Math.random() * userInterests.length)];
                    aiResponseText = await searchInternet(`recent insights and trends in ${randomInterest}`, 'google'); // Default to Google for insights
                    aiResponseText = `Based on your interest in ${randomInterest}, here are some recent insights I found: \n\n` + aiResponseText;
                } else if (connectionStatus === 'offline') {
                    aiResponseText = "I'm sorry, I need to be online to provide insights. Please check your connection.";
                } else {
                    aiResponseText = "I don't have any specific interests set for you yet. Please tell me your interests first (e.g., 'My interests are tech and finance').";
                }
                isSpecialResponse = true;
            }
            // 3. Enhanced Predictive Modeling - Human Behavior based on News
            else if (lowerTrimmedInput.startsWith('predict human behavior based on current news') ||
                     lowerTrimmedInput.startsWith('how will global events affect people') ||
                     lowerTrimmedInput.startsWith('what is the social impact of recent news')) {
                
                addLog(`[DEBUG] Routing human behavior prediction to getAIResponse (internal LLM).`, 'debug');
                // Removed searchInternet call; now directly asks Aurora for her speculative opinion
                aiResponseText = await getAIResponse(
                    `Based on your extensive knowledge and understanding of human society, please provide a thoughtful, speculative prediction on how human behavior might be affected or change in response to recent global events. Emphasize that this is an AI-generated perspective, not a factual forecast.`,
                    chatHistory
                );
                isSpecialResponse = true;
            }
            // 3. Enhanced Predictive Modeling - General Prediction (Aurora's Opinion)
            else if (lowerTrimmedInput.startsWith('predict the future of') || lowerTrimmedInput.startsWith('forecast trends for')) {
                const predictionTopic = trimmedInput.replace(/^(predict the future of|forecast trends for)\s+/i, '').trim();
                addLog(`[DEBUG] Routing general prediction for "${predictionTopic}" to getAIResponse (internal LLM).`, 'debug');
                aiResponseText = await getAIResponse(`Provide a thoughtful, high-level prediction for the future of "${predictionTopic}". Emphasize that this is a speculative, AI-generated perspective, not a factual forecast based on external data.`, chatHistory);
                isSpecialResponse = true;
            }
            // Check for Specific Gauteng News Query
            else if (['top story in gauteng', 'latest news in gauteng', 'gauteng news today', 'what is happening in gauteng'].some(keyword => lowerTrimmedInput.includes(keyword))) {
                isSpecialResponse = true; // Mark as special response to prevent further AI processing
                aiResponseText = "Good evening! While Aurora is quite adept at many things, I currently don't have access to the very latest real-time news headlines to give you the top story in Gauteng today. My information isn't updated minute-by-minute like a live news feed. However, if you have a different question, perhaps about the weather in a specific area, a calculation you need help with, or a language translation, I'd be happy to assist!";
                addLog('Specific Gauteng news query handled.', 'info');
            }
            // Check for General News Query
            else if (['news', 'latest headlines', 'what\'s happening', 'current events'].some(keyword => lowerTrimmedInput.includes(keyword))) {
                const topicMatch = trimmedInput.match(/(?:news about|headlines on|what's happening in|events in)\s+([A-Za-z\s]+?)(?:\?|$|,|\.)/i);
                const topic = topicMatch ? topicMatch[1].trim() : ''; // Get topic or empty string for general news
                aiResponseText = await getNewsHeadlines(topic);
            }
            // --- Normal AI Response via Gemini API ---
            else {
                addLog(`[DEBUG] Falling back to general Gemini AI response. isSpecialResponse: ${isSpecialResponse}`, 'debug');
                try {
                    aiResponseText = await getAIResponse(trimmedInput, chatHistory);
                } catch (error) {
                    console.error('Error getting AI response:', error);
                    aiResponseText = `I'm experiencing some technical difficulties: ${error.message}. Please try again later.`;
                    showNotification(`Failed to get response: ${error.message}`, 'error');
                }
            }
        }

        addLog(`[DEBUG] Final AI Response Text Length: ${aiResponseText.length}`, 'debug');

        // Add AI response to chat history
        const aiMessage = {
            id: `ai-${Date.now()}`,
            role: 'model',
            parts: [{ text: aiResponseText }],
            timestamp: serverTimestamp()
        };
        try {
            await addDoc(collection(db, `artifacts/${__app_id}/users/${userId}/chatHistory`), aiMessage);
            addLog('AI response saved to Firestore.', 'info');
            speak(aiResponseText);
            if (!isSpecialResponse) {
                showNotification('Response received', 'success', 2000);
            }
        } catch (error) {
            console.error("Error saving AI message to Firestore:", error);
            showNotification(`Failed to save AI response: ${error.message}`, 'error');
            addLog(`Failed to save AI response: ${error.message}`, 'error');
        } finally {
            setIsLoading(false);
            addLog(`[DEBUG] handleSendMessage finished. Final hiddenFunctionUnlocked: ${hiddenFunctionUnlocked}`, 'debug');
        }
    }, [userInput, chatHistory, getAIResponse, showNotification, connectionStatus, isAuthReady, db, userId, awaitingPassword, hiddenFunctionUnlocked, getWeatherReport, performCalculationOrConversion, performTranslation, getNewsHeadlines, searchInternet, socialMediaSearch, speak, addLog, systemLogs, userInterests]);

    // Enhanced clear chat with better confirmation
    const handleClearChat = useCallback(async () => {
        if (chatHistory.length === 0) {
            showNotification('Chat is already empty', 'info');
            return;
        }

        const confirmModal = document.createElement('div');
        confirmModal.className = 'modal-overlay';
        confirmModal.innerHTML = `
            <div class="modal-content">
                <h3 class="text-xl font-semibold text-gray-800 mb-4">Confirm Clear Chat</h3>
                <p class="text-gray-700 mb-6">Are you sure you want to clear all chat history? This action cannot be undone.</p>
                <div class="flex justify-end gap-3">
                    <button id="cancelClearBtn" class="px-4 py-2 rounded-lg bg-gray-300 text-gray-800 font-semibold hover:bg-gray-400 transition-colors">Cancel</button>
                    <button id="confirmClearBtn" class="px-4 py-2 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors">Clear Chat</button>
                </div>
            </div>
        `;
        document.body.appendChild(confirmModal);

        document.getElementById('cancelClearBtn').onclick = () => confirmModal.remove();
        document.getElementById('confirmClearBtn').onclick = async () => {
            if (!db || !userId) {
                showNotification('Firebase not ready. Cannot clear chat.', 'error');
                confirmModal.remove();
                return;
            }
            showNotification('Clearing chat history...', 'info');
            setIsLoading(true);
            addLog('Attempting to clear chat history...', 'info');
            try {
                const q = collection(db, `artifacts/${__app_id}/users/${userId}/chatHistory`);
                const querySnapshot = await getDocs(q);
                const deletePromises = [];
                querySnapshot.forEach((docItem) => {
                    deletePromises.push(deleteDoc(doc(db, `artifacts/${__app_id}/users/${userId}/chatHistory`, docItem.id)));
                });
                await Promise.all(deletePromises);
                setChatHistory([]); // Clear local state immediately
                setHiddenFunctionUnlocked(false); // Reset hidden function status on clear
                setAwaitingPassword(false); // Reset password state
                setIsCalvinRecognized(false); // Reset recognition state
                setUserInterests([]); // Reset user interests on clear
                showNotification('Chat history cleared successfully!', 'success');
                addLog('Chat history cleared successfully.', 'success');
            } catch (error) {
                console.error("Error clearing chat history:", error);
                showNotification(`Failed to clear chat: ${error.message}`, 'error');
                addLog(`Failed to clear chat history: ${error.message}`, 'error');
            } finally {
                setIsLoading(false);
                confirmModal.remove();
            }
        };
    }, [chatHistory.length, showNotification, db, userId, addLog]);

    // Format timestamp for display
    const formatTime = useCallback((timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, []);

    // Get notification styles
    const getNotificationStyles = useCallback((type) => {
        const baseStyles = "fixed top-4 right-4 p-4 rounded-lg shadow-lg text-white transition-all duration-300 z-50 max-w-sm";
        const typeStyles = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            warning: 'bg-yellow-500',
            info: 'bg-blue-500'
        };
        return `${baseStyles} ${typeStyles[type] || typeStyles.info}`;
    }, []);

    // --- Core Effects (defined after all useCallback functions) ---

    // Initialize TTS voices
    useEffect(() => {
        const setVoice = () => {
            if (!speechSynthRef.current) {
                addLog('SpeechSynthesis API not ready to get voices.', 'error');
                return;
            }
            const voices = speechSynthRef.current.getVoices();
            addLog(`Available voices: ${voices.map(v => `${v.name} (${v.lang})`).join(', ')}`, 'debug'); // Added for debugging

            let foundVoice = null;

            // 1. Prioritize any en-GB female voice
            foundVoice = voices.find(voice => voice.lang === 'en-GB' && voice.name.includes('Female'));

            // 2. Fallback to any en-GB voice (male or unspecified gender)
            if (!foundVoice) {
                foundVoice = voices.find(voice => voice.lang === 'en-GB');
            }

            // 3. Fallback to any English female voice
            if (!foundVoice) {
                foundVoice = voices.find(voice => voice.lang.startsWith('en') && voice.name.includes('Female'));
            }

            // 4. Fallback to any English voice
            if (!foundVoice) {
                foundVoice = voices.find(voice => voice.lang.startsWith('en'));
            }

            // 5. Final fallback to any available voice
            if (!foundVoice && voices.length > 0) {
                foundVoice = voices[0];
            }

            if (foundVoice) {
                selectedVoiceRef.current = foundVoice;
                addLog(`Selected voice: ${foundVoice.name} (${foundVoice.lang})`, 'info');
            } else {
                addLog('No suitable voice found. Speech output may not work.', 'warning');
                showNotification('No suitable voice found for speech output.', 'warning');
            }
        };

        // Event listener for when voices are loaded/changed
        if (speechSynthRef.current.onvoiceschanged !== undefined) {
            speechSynthRef.current.onvoiceschanged = setVoice;
        }
        // Call immediately in case voices are already loaded before the event fires
        setVoice(); 

        // Cleanup
        return () => {
            if (speechSynthRef.current.onvoiceschanged === setVoice) {
                speechSynthRef.current.onvoiceschanged = null;
            }
        };
    }, [addLog, showNotification]);

    // Check network connectivity
    useEffect(() => {
        const updateConnectionStatus = () => {
            setConnectionStatus(navigator.onLine ? 'online' : 'offline');
            if (!navigator.onLine) {
                showNotification('You are offline. Some features may not work.', 'warning');
                addLog('Network status: Offline', 'warning');
            } else {
                addLog('Network status: Online', 'info');
            }
        };

        window.addEventListener('online', updateConnectionStatus);
        window.addEventListener('offline', updateConnectionStatus);
        updateConnectionStatus();

        return () => {
            window.removeEventListener('online', updateConnectionStatus);
            window.removeEventListener('offline', updateConnectionStatus);
        };
    }, [showNotification, addLog]);

    // Firebase initialization
    useEffect(() => {
        try {
            const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

            if (!Object.keys(firebaseConfig).length) {
                setFirebaseStatus('Firebase config not found. Persistence disabled.');
                showNotification('Firebase configuration missing. Chat history will not be saved.', 'error');
                addLog('Firebase config missing. Persistence disabled.', 'error');
                setIsAuthReady(true); // Allow app to run without persistence
                return;
            }

            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const firebaseAuth = getAuth(app);

            setDb(firestore);
            setAuth(firebaseAuth);

            setFirebaseStatus('Authenticating...');
            addLog('Firebase app initialized. Authenticating...', 'info');

            // Listen for auth state changes
            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setFirebaseStatus(`Authenticated: ${user.uid}`);
                    addLog(`Authenticated successfully: ${user.uid}`, 'success');
                    setIsAuthReady(true);
                } else {
                    // Sign in anonymously if no user is found
                    try {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                            setFirebaseStatus('Signed in with custom token.');
                            addLog('Signed in with custom token.', 'info');
                        } else {
                            await signInAnonymously(firebaseAuth);
                            setFirebaseStatus('Signed in anonymously.');
                            addLog('Signed in anonymously.', 'info');
                        }
                    } catch (error) {
                        console.error("Firebase Auth Error:", error);
                        setFirebaseStatus(`Auth Error: ${error.message}`);
                        showNotification(`Authentication failed: ${error.message}. Chat history will not be saved.`, 'error');
                        addLog(`Authentication failed: ${error.message}`, 'error');
                        setIsAuthReady(true); // Allow app to run even if auth fails
                    }
                }
            });

            // Add a check for google_search availability (only log once)
            const checkAndMockGoogleSearch = () => {
                if (typeof window.google_search === 'undefined' || typeof window.google_search.search !== 'function') {
                    addLog('Google Search tool (window.google_search) is UNAVAILABLE or malformed. Providing mock implementation.', 'warning');
                    window.google_search = {
                        search: async (queries) => {
                            const query = queries[0].toLowerCase();
                            if (query.includes('capital of france')) {
                                return [{ query: queries[0], results: [{ source_title: 'Wikipedia', snippet: 'Paris is the capital of France.', url: 'https://en.wikipedia.org/wiki/Paris' }] }];
                            }
                            // Generic mock response for other queries
                            return [{ query: queries[0], results: [{ source_title: 'Mock Search', snippet: `This is a mock search result for "${queries[0]}".`, url: 'https://example.com/mock' }] }];
                        }
                    };
                } else {
                    addLog('Google Search tool (window.google_search) appears to be AVAILABLE on app load.', 'info');
                }
            };
            checkAndMockGoogleSearch();

            // Add a check for duckduckgo_search availability (only log once)
            const checkAndMockDuckDuckGoSearch = () => {
                if (typeof window.duckduckgo_search === 'undefined' || typeof window.duckduckgo_search.search !== 'function') {
                    addLog('DuckDuckGo Search tool (window.duckduckgo_search) is UNAVAILABLE or malformed. Providing mock implementation.', 'warning');
                    window.duckduckgo_search = {
                        search: async (queries) => {
                            // Generic mock response for DuckDuckGo
                            return [{ query: queries[0], results: [{ source_title: 'Mock DuckDuckGo', snippet: `This is a mock DuckDuckGo result for "${queries[0]}".`, url: 'https://example.com/mock-ddg' }] }];
                        }
                    };
                } else {
                    addLog('DuckDuckGo Search tool (window.duckduckgo_search) appears to be AVAILABLE on app load.', 'info');
                }
            };
            checkAndMockDuckDuckGoSearch();

            // Add a check for wolfram_alpha availability (only log once)
            const checkAndMockWolframAlpha = () => {
                if (typeof window.wolfram_alpha === 'undefined' || typeof window.wolfram_alpha.query !== 'function') {
                    addLog('Wolfram Alpha tool (window.wolfram_alpha) is UNAVAILABLE or malformed. Providing mock implementation.', 'warning');
                    window.wolfram_alpha = {
                        query: async (query) => {
                            const lowerQuery = query.toLowerCase();
                            if (lowerQuery.includes('capital of france')) {
                                return "Paris, France.";
                            }
                            // Simulate no specific answer for other queries to trigger fallback
                            return "WOLFRAM_ALPHA_NO_SPECIFIC_ANSWER_FOUND";
                        }
                    };
                } else {
                    addLog('Wolfram Alpha tool (window.wolfram_alpha) appears to be AVAILABLE on app load.', 'info');
                }
            };
            checkAndMockWolframAlpha();

            return () => unsubscribe(); // Cleanup auth listener
        } catch (error) {
            console.error("Firebase Initialization Error:", error);
            setFirebaseStatus(`Init Error: ${error.message}`);
            showNotification(`Failed to initialize Firebase: ${error.message}. Chat history will not be saved.`, 'error');
            addLog(`Firebase initialization failed: ${error.message}`, 'error');
            setIsAuthReady(true); // Allow app to run without persistence
        }
    }, [showNotification, addLog]);

    // --- Firestore Chat History Listener ---
    useEffect(() => {
        if (!db || !userId || !isAuthReady) {
            return; // Wait for Firebase to be ready and user to be authenticated
        }

        const chatCollectionRef = collection(db, `artifacts/${__app_id}/users/${userId}/chatHistory`);
        const q = query(chatCollectionRef, orderBy('timestamp', 'asc'));

        setFirebaseStatus('Loading chat history...');
        addLog('Attempting to load chat history from Firestore...', 'info');
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const messages = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data() 
            }));
            setChatHistory(messages);
            setFirebaseStatus('Memory loaded.');
            addLog('Chat history loaded successfully.', 'success');
            scrollToBottom(); // Scroll to bottom after loading/updating
        }, (error) => {
            console.error("Error fetching chat history:", error);
            setFirebaseStatus(`History Error: ${error.message}`);
            showNotification(`Failed to load chat history: ${error.message}`, 'error');
            addLog(`Failed to load chat history: ${error.message}`, 'error');
        });

        return () => unsubscribe(); // Cleanup snapshot listener
    }, [db, userId, isAuthReady, scrollToBottom, showNotification, addLog]);

    // --- Speech Recognition Setup ---
    useEffect(() => {
        if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
            showNotification('Speech Recognition not supported in this browser.', 'warning');
            addLog('Speech Recognition API not supported.', 'warning');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        // Initialize and assign directly to ref.current
        recognitionRef.current = new SpeechRecognition();
        
        // Corrected line: Use recognitionRef.current directly
        const recognition = recognitionRef.current; 

        // Now configure using recognition directly
        recognition.continuous = false; 
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            setIsListening(true);
            showNotification('🎤 Listening for your command...', 'info', 2000);
            addLog('Speech recognition started.', 'info');
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            const confidence = event.results[0][0].confidence;
            
            setUserInput(transcript);
            setIsListening(false);
            
            if (confidence > 0.7) {
                showNotification('✅ Voice command received', 'success', 2000);
                addLog(`Voice input received: "${transcript}" (Confidence: ${confidence.toFixed(2)})`, 'info');
                // Auto-send after a short delay
                setTimeout(() => {
                    // Create a synthetic event object to pass to handleSendMessage
                    const syntheticEvent = {
                        preventDefault: () => {},
                        target: { value: transcript }
                    };
                    handleSendMessage(syntheticEvent);
                }, 500);
            } else {
                showNotification('⚠️ Low confidence for voice command, please check the text', 'warning');
                addLog(`Low confidence voice input: "${transcript}" (Confidence: ${confidence.toFixed(2)})`, 'warning');
            }
        };

        recognition.onerror = (event) => {
            setIsListening(false);
            const errorMessages = {
                'network': 'Network error. Please check your connection.',
                'not-allowed': 'Microphone access denied. Please allow microphone access.',
                'no-speech': 'No speech detected for command. Try again.',
                'aborted': 'Voice command was cancelled.',
                'audio-capture': 'No microphone found or audio capture failed.',
                'service-not-allowed': 'Speech recognition service not allowed.'
            };
            
            const message = errorMessages[event.error] || `Voice command error: ${event.error}`;
            showNotification(message, 'error');
            addLog(`Speech recognition error: ${event.error} - ${message}`, 'error');
        };

        recognition.onend = () => {
            setIsListening(false);
            addLog('Speech recognition ended.', 'info');
        };

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.abort();
            }
        };
    }, [showNotification, addLog, handleSendMessage]); // Added handleSendMessage to dependencies

    // Auto-scroll when new messages arrive
    useEffect(() => {
        scrollToBottom();
    }, [chatHistory, scrollToBottom]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4 font-sans text-gray-800">
            {/* Enhanced Notification Display */}
            {notification.message && (
                <div className={getNotificationStyles(notification.type)}>
                    <div className="flex items-center">
                        <span className="flex-1">{notification.message}</span>
                        <button 
                            onClick={() => setNotification({ message: '', type: '' })}
                            className="ml-2 text-white hover:text-gray-200"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-2xl overflow-hidden w-full max-w-4xl flex flex-col h-[85vh] border border-gray-200">
                {/* Enhanced Header */}
                <header className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-4 shadow-md">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            
                            <div>
                                <h1 className="text-xl font-bold">Aurora</h1>
                                <p className="text-blue-200 text-sm">Version 1.0</p>
                            </div>
                        </div>
                        
                        <div className="flex items-center space-x-4 text-sm">
                            {hiddenFunctionUnlocked && (
                                <span className="px-2 py-1 bg-purple-500 text-white rounded-full text-xs font-semibold">
                                    Creator Mode
                                </span>
                            )}
                            <div className="flex items-center space-x-2">
                                <div className={`w-2 h-2 rounded-full ${connectionStatus === 'online' ? 'bg-green-400' : 'bg-red-400'}`}></div>
                                <span className="text-blue-200 capitalize">{connectionStatus}</span>
                            </div>
                            
                            <div className="text-blue-200">
                                {firebaseStatus}
                            </div>
                            
                            {/* Removed Test Voice Button */}
                            <button
                                onClick={handleClearChat}
                                className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors duration-200 text-sm disabled:opacity-50"
                                disabled={isLoading}
                                title="Clear chat history"
                            >
                                Clear Memory
                            </button>
                        </div>
                    </div>
                </header>

                {/* Enhanced Chat Messages Area */}
                <div className="flex-1 p-6 overflow-y-auto bg-gray-50 space-y-4">
                    {!isAuthReady ? (
                        <div className="text-center text-gray-500 mt-10">
                            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                            <p className="text-lg">Connecting to Aurora's memory...</p>
                            <p className="text-sm mt-2">{firebaseStatus}</p>
                        </div>
                    ) : chatHistory.length === 0 ? (
                        <div className="text-center text-gray-500 mt-10">
                            
                            <h2 className="text-2xl font-semibold mb-2">Hello! I'm Aurora</h2>
                            <p className="text-lg mb-4">Your AI assistant created by Calvin</p>
                            <div className="bg-white rounded-lg p-4 shadow-sm max-w-md mx-auto">
                                <p className="text-sm text-gray-600 mb-2">How can I help you?</p>
                            </div>
                        </div>
                    ) : (
                        chatHistory.map((message) => (
                            <div
                                key={message.id}
                                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div className={`max-w-[80%] ${message.role === 'user' ? 'order-2' : 'order-1'}`}>
                                    <div className={`p-4 rounded-2xl shadow-sm ${
                                        message.role === 'user'
                                            ? 'bg-blue-500 text-white rounded-br-sm'
                                            : 'bg-white text-gray-800 rounded-bl-sm border'
                                    }`}>
                                        {message.parts.map((part, pIdx) => (
                                            <p key={pIdx} className="whitespace-pre-wrap leading-relaxed">
                                                {part.text}
                                            </p>
                                        ))}
                                        {message.role === 'model' && message.parts.length > 0 && (
                                            <button
                                                onClick={() => handleCopy(message.parts[0].text)}
                                                className="mt-2 px-2 py-1 bg-gray-200 text-gray-700 rounded-md text-xs hover:bg-gray-300 transition-colors flex items-center"
                                                title="Copy to clipboard"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m-4 0h-4" />
                                                </svg>
                                                Copy
                                            </button>
                                        )}
                                    </div>
                                    <div className={`text-xs text-gray-400 mt-1 ${
                                        message.role === 'user' ? 'text-right' : 'text-left'
                                    }`}>
                                        {formatTime(message.timestamp)}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                    
                    {/* Enhanced Loading Indicator */}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white text-gray-800 rounded-2xl rounded-bl-sm border p-4 shadow-sm">
                                <div className="flex items-center space-x-2">
                                    <div className="flex space-x-1">
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                                    </div>
                                    <span className="text-sm text-gray-500">Aurora is thinking...</span>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <div ref={messagesEndRef} />
                </div>

                {/* Enhanced Input Area */}
                <div className="p-4 bg-white border-t border-gray-200">
                    <div className="flex items-end space-x-3">
                        <div className="flex-1">
                            <textarea
                                value={userInput}
                                onChange={(e) => setUserInput(e.target.value)}
                                placeholder={isListening ? "🎤 Listening..." : (awaitingPassword ? "Enter password..." : "Type your message here...")}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none text-gray-800"
                                disabled={isLoading || isListening || !isAuthReady}
                                rows={userInput.includes('\n') ? Math.min(userInput.split('\n').length, 4) : 1}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendMessage({ preventDefault: () => {} });
                                    }
                                }}
                            />
                        </div>
                        
                        <button
                            type="button"
                            onClick={toggleListening}
                            className={`p-3 rounded-lg shadow-md transition-all duration-200 ${
                                isListening 
                                    ? 'bg-red-500 hover:bg-red-600 animate-pulse' 
                                    : 'bg-gray-500 hover:bg-gray-600'
                            } text-white disabled:opacity-50 disabled:cursor-not-allowed`}
                            disabled={isLoading || !recognitionRef.current || !isAuthReady || connectionStatus === 'offline'}
                            title={isListening ? "Stop listening" : "Start voice input"}
                        >
                            🎤 {isSpeaking && <span className="text-xs ml-1">🔊</span>}
                        </button>
                        
                        <button
                            type="button"
                            onClick={() => handleSendMessage({ preventDefault: () => {} })}
                            className="px-6 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                            disabled={isLoading || !isAuthReady || !userInput.trim() || connectionStatus === 'offline'}
                        >
                            {isLoading ? (
                                <div className="flex items-center space-x-2">
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    <span>Sending...</span>
                                </div>
                            ) : (
                                'Send'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
