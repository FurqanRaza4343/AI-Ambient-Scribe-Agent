import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize Gemini SDK with defensive validation for API key
let ai: GoogleGenAI | null = null;
const API_KEY = process.env.GEMINI_API_KEY;

if (API_KEY && API_KEY !== "MY_GEMINI_API_KEY") {
  try {
    ai = new GoogleGenAI({
      apiKey: API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    console.log("Gemini SDK initialized successfully on the server.");
  } catch (err) {
    console.error("Error initializing Gemini SDK:", err);
  }
} else {
  console.log("GEMINI_API_KEY not configured or placeholder detected. Running on clinical simulated fallback engines.");
}

// Helper functions for Mistral API integration with multi-key failover
async function generateContentWithMistral(prompt: string, expectJson: boolean = false): Promise<{ text: string; source: string }> {
  const keys = [
    process.env.MISTRAL_API_KEY,
    process.env.MISTRAL_API_KEY2,
    process.env["MISTRAL_API-KEY2"]
  ].filter(key => key && key.trim() !== "" && key !== "MY_MISTRAL_API_KEY");

  if (keys.length === 0) {
    throw new Error("No valid Mistral API keys configured.");
  }

  let lastError: any = null;
  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    try {
      console.log(`Sending API request to Mistral (attempt ${i + 1}/${keys.length})...`);
      const payload: any = {
        model: "mistral-small-latest",
        messages: [{ role: "user", content: prompt }]
      };
      if (expectJson) {
        payload.response_format = { type: "json_object" };
      }

      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Mistral API Error (Status: ${res.status}): ${errText}`);
      }

      const data: any = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) {
        return { text: content, source: "mistral-small-latest" };
      }
      throw new Error("Empty response from Mistral API structure.");
    } catch (err: any) {
      console.warn(`Mistral API Key attempt ${i + 1} failed:`, err.message);
      lastError = err;
    }
  }
  throw lastError || new Error("All Mistral keys failed.");
}

function cleanAndParseJson(text: string): any {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json\s*/i, "");
    cleaned = cleaned.replace(/^```\s*/, "");
    cleaned = cleaned.replace(/\s*```$/, "");
  }
  return JSON.parse(cleaned.trim());
}

// Global API Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    geminiInitialized: ai !== null,
    timestamp: new Date().toISOString()
  });
});

/**
 * AGENT 1: Transcript Agent End-point
 * Format unstructured speech transcripts into patient-provider dialogue.
 */
app.post("/api/agent/transcript", async (req, res) => {
  const { rawText, patientName, patientAge } = req.body;
  if (!rawText || rawText.trim() === "") {
    return res.status(400).json({ error: "No transcription text provided." });
  }

  const prompt = `
You are the Transcript Agent. Convert the following unstructured, potentially messy speech-to-text or clinical recording transcript into a clean, professional, chronologically organized medical dialogue between the Patient (and/or family) and the Practing Clinician/Provider.

Patient Name: ${patientName || "Unknown"}
Patient Age: ${patientAge || "Unknown"}

Do not invent clinical findings or medical details that aren't mentioned or strongly implied, but tidy up stutters, filler words, repetitive speech, and make it clear who is speaking (e.g. "Doctor:", "Patient:").

Raw Transcript:
"${rawText}"

Return the formatted conversation directly. Provide no other conversational text outside of the dialogue itself.
`;

  // 1. Try Mistral
  try {
    const result = await generateContentWithMistral(prompt, false);
    return res.json({
      transcript: result.text,
      source: "Mistral " + result.source
    });
  } catch (mistralError: any) {
    console.log("Mistral run failed in Transcript Agent, trying Gemini:", mistralError.message);
  }

  // 2. Try Gemini
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });
      return res.json({
        transcript: response.text || rawText,
        source: "Gemini 3.5-flash"
      });
    } catch (geminiError: any) {
      console.error("Gemini failed in Transcript Agent:", geminiError.message);
    }
  }

  // 3. Try Simulation Fallback
  console.log("Using Simulation Fallback for Transcript Agent.");
  const formattedFallback = simulateTranscriptFormatting(rawText, patientName);
  res.json({
    transcript: formattedFallback,
    source: "simulation_engine"
  });
});

/**
 * AGENT 2: Medical Extraction Agent End-point
 * Extracts symptoms, medicines, duration, allergies, and diagnoses mentioned.
 */
app.post("/api/agent/extraction", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: "Transcript is required for extraction." });
  }

  const prompt = `
You are the Medical Extraction Agent. Read the patient-provider encounter transcript below and extract key clinical attributes.

Encounter Transcript:
"${transcript}"

Extract the following information:
1. Symptoms: List clearly (e.g. Chest pain, dry cough, dizziness).
2. Medicines: Any current or newly prescribed medicines mentioned, including their name, dosage, frequency, and duration if specified.
3. Duration: Duration of the symptoms (e.g., "3 days", "2 weeks").
4. Allergies: Any allergies specified by the patient (e.g. "Penicillin", "Sulfa drugs"). State "NKDA" (No Known Drug Allergies) if none are mentioned.
5. Diagnoses mentioned: Any explicit diagnoses mentioned or suspected by the doctor or patient (e.g. Acute Bronchitis, Hypertension, GERD).

Provide findings in JSON matching this schema:
{
  "symptoms": ["string"],
  "medicines": [{"name": "string", "dosage": "string", "frequency": "string", "duration": "string"}],
  "duration": "string",
  "allergies": ["string"],
  "diagnosesMentioned": ["string"]
}
`;

  // 1. Try Mistral
  try {
    const result = await generateContentWithMistral(prompt, true);
    const parsedJson = cleanAndParseJson(result.text);
    return res.json({
      extraction: parsedJson,
      source: "Mistral " + result.source
    });
  } catch (mistralError: any) {
    console.log("Mistral run failed in Extraction Agent, trying Gemini:", mistralError.message);
  }

  // 2. Try Gemini
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["symptoms", "medicines", "duration", "allergies", "diagnosesMentioned"],
            properties: {
              symptoms: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of symptoms mentioned by the patient."
              },
              medicines: {
                type: Type.ARRAY,
                description: "Medications mentioned or prescribed during the encounter.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    dosage: { type: Type.STRING },
                    frequency: { type: Type.STRING },
                    duration: { type: Type.STRING }
                  }
                }
              },
              duration: {
                type: Type.STRING,
                description: "How long symptoms have been present."
              },
              allergies: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Mentioned allergies. If none, NKDA."
              },
              diagnosesMentioned: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Suspected or verified medical diagnoses discussed during the visit."
              }
            }
          }
        }
      });

      const parsedJson = cleanAndParseJson(response.text || "{}");
      return res.json({
        extraction: parsedJson,
        source: "Gemini 3.5-flash"
      });
    } catch (geminiError: any) {
      console.error("Gemini failed in Extraction Agent:", geminiError.message);
    }
  }

  // 3. Try Simulation Fallback
  console.log("Using Simulation Fallback for Extraction Agent.");
  res.json({
    extraction: simulateMedicalExtraction(transcript),
    source: "simulation_engine"
  });
});

/**
 * AGENT 3: SOAP Note Agent End-point
 * Generates Subjective, Objective, Assessment, Plan documentation based on transcript & extraction.
 */
app.post("/api/agent/soap", async (req, res) => {
  const { transcript, extraction } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: "Transcript is required for SOAP note." });
  }

  const prompt = `
You are the SOAP Note Agent. Create a highly professional, clinical-grade SOAP (Subjective, Objective, Assessment, Plan) note based on the clinical transcript and some preliminary structured medical extractions.

Transcript:
"${transcript}"

Extractions:
${JSON.stringify(extraction, null, 2)}

Requirements for each section:
1. Subjective: Capture the chief complaint, history of present illness (HPi), relevant symptoms (onset, severity, qualifiers) and allergies or pertinent histories mentioned by the patient.
2. Objective: Formulate objective findings. Note everything stated during examinations, physical metrics discussed (like temp, blood pressure mentioned), or general clinical observation signs spoken.
3. Assessment: List suspected or diagnosed conditions, differential diagnoses, status of ongoing conditions, and clinical reasoning.
4. Plan: Create actionable steps, including prescriptions, dosages, tests, lifestyle recommendations, follow-up timeline, and safety netting guidelines.

Generate a JSON object matching this schema:
{
  "subjective": "string",
  "objective": "string",
  "assessment": "string",
  "plan": "string"
}

Ensure the language is technical, clear, and meets HIPAA / standard clinical formatting guidelines.
`;

  // 1. Try Mistral
  try {
    const result = await generateContentWithMistral(prompt, true);
    const parsedJson = cleanAndParseJson(result.text);
    return res.json({
      soap: parsedJson,
      source: "Mistral " + result.source
    });
  } catch (mistralError: any) {
    console.log("Mistral run failed in SOAP Agent, trying Gemini:", mistralError.message);
  }

  // 2. Try Gemini
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["subjective", "objective", "assessment", "plan"],
            properties: {
              subjective: { type: Type.STRING },
              objective: { type: Type.STRING },
              assessment: { type: Type.STRING },
              plan: { type: Type.STRING }
            }
          }
        }
      });

      const parsedJson = cleanAndParseJson(response.text || "{}");
      return res.json({
        soap: parsedJson,
        source: "Gemini 3.5-flash"
      });
    } catch (geminiError: any) {
      console.error("Gemini failed in SOAP Agent:", geminiError.message);
    }
  }

  // 3. Try Simulation Fallback
  console.log("Using Simulation Fallback for SOAP Agent.");
  res.json({
    soap: simulateSoapDraft(transcript, extraction),
    source: "simulation_engine"
  });
});

/**
 * AGENT 4: RAG Agent End-point
 * Formats/re-structures the SOAP Note based on selected Hospital Templates or Policies.
 */
app.post("/api/agent/rag", async (req, res) => {
  const { soapNote, templateId, templateName, promptGuideline } = req.body;
  if (!soapNote) {
    return res.status(400).json({ error: "SOAP Note is required for RAG formatting." });
  }

  const prompt = `
You are the RAG (Retrieval Augmented Generation) Agent. Your task is to align and style the existing Clinical SOAP Note to match parent hospital templates and quality compliance protocols from "${templateName}".

Template / Hospital Guideline Profile:
"${promptGuideline}"

Original SOAP Note draft:
- Subjective: ${soapNote.subjective}
- Objective: ${soapNote.objective}
- Assessment: ${soapNote.assessment}
- Plan: ${soapNote.plan}

Task:
Reformat each of the 4 sections of the SOAP note to adhere strictly to the specified guidelines.
Do not change the fundamental clinical findings or invent fake test results, but restructure the sections, alter the tone, add specific structural subsections, or append mandatory compliance checklists as defined by the guideline prompt.

Return the modified note in a JSON schema:
{
  "subjective": "string",
  "objective": "string",
  "assessment": "string",
  "plan": "string"
}
`;

  // 1. Try Mistral
  try {
    const result = await generateContentWithMistral(prompt, true);
    const parsedJson = cleanAndParseJson(result.text);
    return res.json({
      soapFormatted: parsedJson,
      source: "Mistral " + result.source
    });
  } catch (mistralError: any) {
    console.log("Mistral run failed in RAG Agent, trying Gemini:", mistralError.message);
  }

  // 2. Try Gemini
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["subjective", "objective", "assessment", "plan"],
            properties: {
              subjective: { type: Type.STRING },
              objective: { type: Type.STRING },
              assessment: { type: Type.STRING },
              plan: { type: Type.STRING }
            }
          }
        }
      });

      const parsedJson = cleanAndParseJson(response.text || "{}");
      return res.json({
        soapFormatted: parsedJson,
        source: "Gemini 3.5-flash"
      });
    } catch (geminiError: any) {
      console.error("Gemini failed in RAG Agent:", geminiError.message);
    }
  }

  // 3. Try Simulation Fallback
  console.log("Using Simulation Fallback for RAG Agent.");
  res.json({
    soapFormatted: simulateRagFormatting(soapNote, templateId),
    source: "simulation_engine"
  });
});

/**
 * AGENT 5: Safety Agent End-point
 * Audits the transcript, extraction, and formatted SOAP note for red flags, omissions, errors.
 */
app.post("/api/agent/safety", async (req, res) => {
  const { transcript, extraction, soapNote } = req.body;
  if (!transcript || !soapNote) {
    return res.status(400).json({ error: "Transcript and SOAP note are required for Safety Audit." });
  }

  const prompt = `
You are the Medical Safety Agent. Your primary objective is clinical quality assurance. Audit the clinical encounter files to identify any clinical risks, missing critical details, red flags, or potential drug-allergy contraindications.

Transcript:
"${transcript}"

Medical Extraction:
${JSON.stringify(extraction, null, 2)}

SOAP Note Draft:
- Subjective: ${soapNote.subjective}
- Objective: ${soapNote.objective}
- Assessment: ${soapNote.assessment}
- Plan: ${soapNote.plan}

Examine carefully:
1. Red Flags: Identify critical acute symptoms (e.g. chest pain, shortness of breath, slurred speech/weakness, sudden severe headache, extremely high blood pressure).
2. Omissions: Is there a vital clinical detail mentioned in the patient's testimony that is completely missing from the assessment or plan? (e.g. patient mentions a penicillin allergy, but wait did we prescribe amoxicillin? Or did we miss their symptoms of dizziness?)
3. Contraindications: Compare known patient allergies listed in extractions against any active/new medicine plans. For instance, if patient is allergic to "Penicillin" and the plan prescribes "Amoxicillin" or "Penicillin VK", raise a HIGH contraindication!
4. Actionable Recommendations: Create precise recommendations for the clinician to review before final confirmation.

Provide details in a structured JSON schema:
{
  "isSafe": boolean,
  "redFlagsIdentified": ["string"],
  "missingDetails": ["string"],
  "contraindicationsDetected": ["string"],
  "severity": "low" | "medium" | "high",
  "recommendations": ["string"]
}
`;

  // 1. Try Mistral
  try {
    const result = await generateContentWithMistral(prompt, true);
    const parsedJson = cleanAndParseJson(result.text);
    return res.json({
      safety: parsedJson,
      source: "Mistral " + result.source
    });
  } catch (mistralError: any) {
    console.log("Mistral run failed in Safety Agent, trying Gemini:", mistralError.message);
  }

  // 2. Try Gemini
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["isSafe", "redFlagsIdentified", "missingDetails", "contraindicationsDetected", "severity", "recommendations"],
            properties: {
              isSafe: { type: Type.BOOLEAN },
              redFlagsIdentified: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Immediate critical red flag symptoms detected in the dialogue."
              },
              missingDetails: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Items mentioned by patient that are absent from the clinical SOAP draft."
              },
              contraindicationsDetected: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Allergic or medical-guideline conflicts detected in medicines vs conditions."
              },
              severity: {
                type: Type.STRING,
                description: "The clinical risk flag level."
              },
              recommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Practical checklist bullet points for the provider to edit or safety-proof."
              }
            }
          }
        }
      });

      const parsedJson = cleanAndParseJson(response.text || "{}");
      return res.json({
        safety: parsedJson,
        source: "Gemini 3.5-flash"
      });
    } catch (geminiError: any) {
      console.error("Gemini failed in Safety Agent:", geminiError.message);
    }
  }

  // 3. Try Simulation Fallback
  console.log("Using Simulation Fallback for Safety Agent.");
  res.json({
    safety: simulateSafetyCheck(transcript, extraction, soapNote),
    source: "simulation_engine"
  });
});


/**
 * AGENT 6: Patient Layman Summary Agent
 * Compiles a compassionate, human-readable overview explaining to the patient what happened in simple terms.
 */
app.post("/api/agent/layman", async (req, res) => {
  const { patientName, extraction, soapNote } = req.body;
  if (!extraction || !soapNote) {
    return res.status(400).json({ error: "Extraction data and SOAP note are required to generate layman summary." });
  }

  const prompt = `
You are the Patient Guide Agent. Translate the dense clinical SOAP medical note and medical extraction records below into a highly compassionate, supportive, and extremely clear patient layman summary.

Patient Name: ${patientName || "Patient"}

Clinical Extraction Record:
${JSON.stringify(extraction, null, 2)}

SOAP Medical Draft:
- Subjective: ${soapNote.subjective}
- Objective: ${soapNote.objective}
- Assessment: ${soapNote.assessment}
- Plan: ${soapNote.plan}

Please cover these sections using warm, reassuring, human-first vocabulary (avoid dense billing jargon or raw medical shorthand unless you clearly explain it):
1. **Hello & Summary**: A kind greeting and simple, conversational breakdown explaining exactly what condition or symptoms are suspected/identified. Explain the cause in human terms.
2. **Your Treatment Plan**: Easy-to-understand recovery steps (e.g. rest, warm fluids, lifestyle care).
3. **Your Medications**: A bulleted breakdown of any medicines prescribed. Explain *what they are*, *how to take them*, and *why you are taking them* in standard plain language.
4. **When to Seek Immediate Help**: Critical but non-panic-inducing safety net warnings defining precise red flags where they should seek urgent medical help immediately.

Write the summary in beautifully spaced, elegant clinical-guide format using clear headings. Keep the tone human, empathetic, and professional.
`;

  // 1. Try Mistral
  try {
    const result = await generateContentWithMistral(prompt, false);
    return res.json({
      summary: result.text,
      source: "Mistral " + result.source
    });
  } catch (mistralError: any) {
    console.log("Mistral run failed in Layman summary, trying Gemini:", mistralError.message);
  }

  // 2. Try Gemini
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });

      return res.json({
        summary: response.text || simulateLaymanSummary(patientName || "Patient", extraction, soapNote),
        source: "Gemini 3.5-flash"
      });
    } catch (geminiError: any) {
      console.error("Gemini failed in Layman summary Agent:", geminiError.message);
    }
  }

  // 3. Try Simulation Fallback
  console.log("Using Simulation Fallback for Layman Summary Agent.");
  res.json({
    summary: simulateLaymanSummary(patientName || "Patient", extraction, soapNote),
    source: "simulation_engine"
  });
});

// Layman summary simulation engine fallback
function simulateLaymanSummary(patientName: string, extraction: any, soapNote: any) {
  const ext = extraction || {};
  const diagnosis = (ext.diagnosesMentioned && ext.diagnosesMentioned[0]) || "clinical symptoms";
  const symptomsStr = (ext.symptoms || []).join(", ").toLowerCase();
  
  if (diagnosis.toLowerCase().includes("bronchitis") || diagnosis.toLowerCase().includes("cough")) {
    return `### Hello ${patientName},

I have completed processing your visit details. Here is a clear, step-by-step breakdown of your clinical consultation so you know exactly what is going on and how to recover safely.

---

### 1. What is happening
Based on your discussion with the doctor, we suspect you have **Acute Bronchitis**, which is a temporary inflammation or swelling in the airways leading to your lungs. 
* This is why you are experiencing a heavy wet cough with yellow phlegm, a fever peaking around 101.5°F, shivering chills, and feeling extremely tired.
* The doctor heard crackling signs in the base of your right lung, which are typical for congestion but need careful monitoring.

---

### 2. Your Recover Plan & Comfort Care
To help your body fight this off and recover strength:
* **Get plenty of bed rest**: Your body is using a lot of energy to clear the inflammation.
* **Stay hydrated**: Drink plenty of warm water, decaffeinated tea, or soups (try for 2 to 3 liters daily). This is critical to thin out the thick yellow sputum so your cough can clear it easily.
* **Avoid smoke & irritants**: Stay away from household dust, tobacco smoke, or cold dry drafts.

---

### 3. Your Prescribed Medications
We want to treat this aggressively to keep it from settling further into your lungs:
* **Amoxicillin (500 mg)**
  * **How to take**: Take 1 capsule by mouth three times a day (every 8 hours) with or without food.
  * **Duration**: Finish the entire 7-day bottle, even if you start feeling completely fine in a few days. Stopping early can allow the infection to return stronger.
  * **Why**: This is a safe antibiotic designed to eliminate the bacteria causing your chest infection.
* **Acetaminophen / Tylenol (500 mg)**
  * **How to take**: Take 1 tablet every 6 hours as needed. Do not exceed 6 tablets within 24 hours.
  * **Why**: This will keep your fever down, soothe your shivering chills, and relieve your body aches.

---

### 4. 🚨 Warnings & When to Seek Urgent Help
Please rest up, but monitor your symptoms closely. Go to the nearest urgent care or emergency room if you experience any of these:
* You find it suddenly very hard to catch your breath or feel tight gasping.
* You notice blood in your phlegm when coughing.
* Your fever spikes above 103°F or does not come down at all after taking fever-reducing medicine.
* Your cough does not get better or starts getting worse after 5 to 7 days.

We are fully committed to your recovery. Please get plenty of sleep, and reach out to the clinic triage line if you have any questions!`;
  }

  if (diagnosis.toLowerCase().includes("angina") || diagnosis.toLowerCase().includes("coronary") || diagnosis.toLowerCase().includes("chest")) {
    return `### Hello ${patientName},

We have completed compiling your urgent medical findings. This is a very critical time, and we want to explain exactly what is going on with your heart in clear, straightforward terms.

---

### 1. What is happening
You presented with **severe crushing chest pressure** that woke you up at 4:30 AM. You described it beautifully as an "elephant standing on your chest", radiating into your left neck, shoulder, and left arm.
* This classic presentation points strongly to **Unstable Angina** or **Acute Coronary Syndrome**, meaning there is a severe temporary restriction of blood flow and oxygen supply trying to reach your heart muscle. 
* Your body reacted with a fast heartbeat (104 beats per minute), sweating, dizziness, nausea, and shortness of breath.
* *Note*: Your severe allergy to **Penicillin** is logged prominently so all medical staff are aware.

---

### 2. What We Are Doing Immediately
Because your heart muscle is requesting immediate energy and oxygen, we are keeping you on strict bed rest and taking immediate diagnostic actions:
* We have ordered a **Stat 12-lead ECG** (electrocardiogram) to trace the electrical rhythm of your heart.
* We have drawn blood for **Stat Troponin** levels. Troponins are proteins that release into your bloodstream if the heart muscle is experiencing strain or damage.
* We are placing an oxygen monitor on your finger and putting you on continuous telemetry to watch your heart live.

---

### 3. Your Prescribed Medication Interventions
To relieve the pressure on your heart and prevent further blocks:
* **Chewable Aspirin (325 mg) - Given immediately**
  * **Why**: This thins your blood instantly to help blood flow smoothly past any tight areas in your arteries.
* **Sublingual Nitroglycerin (0.4 mg) - Melt under tongue**
  * **Why**: This dilates and opens up your blood vessels to instantly restore oxygen flow to your heart and relieve that crushing chest pain. 
  * *Important Safety Note*: We have verified you have not taken any erectile dysfunction drugs (like Viagra) recently, as the combination can cause safe-critical drops in blood pressure.

---

### 4. 🚨 Warning Guidance
This is a medical emergency. You are under active clinical monitoring. Please tell the nurse or doctor *immediately* if:
* You feel even slightly more chest pain, squeezing, or radiating pressure.
* You start feeling faint, dizzy, or break out in heavier sweats.
* Your breathing gets harder.

Please lay flat and rest comfortably. We are monitoring you every single second.`;
  }

  if (diagnosis.toLowerCase().includes("asthma") || diagnosis.toLowerCase().includes("wheezing")) {
    return `### Hello Leo & Family,

We have completed translating Leo's medical evaluation findings. We want to make sure you have a very clear path forward to get Leo's breathing back to 100% comfort.

---

### 1. What is happening
Leo is experiencing an **acute flare-up of his Mild Persistent Asthma**. 
* This means the little airways inside his lungs have become tight and slightly swollen, making it harder for air to flow smoothly. This causes his active **expiratory wheezing** (that whistling sound the doctor heard when Leo exhaled) and his dry nighttime cough.
* His increased reliance on the quick-relief Albuterol inhaler suggests his current preventative regimen needs a temporary boost to calm his lungs down.
* *Allergy Alert*: We have highlighted his **severe peanut allergy** (which causes dangerous lip swelling) in high-contrast red in all of his charts.

---

### 2. Immediate Care Plan
* **Nebulizer Treatment**: We are administering an Albuterol nebulizer treatment in the clinic's calm space right now to relax his airway muscles instantly.
* **Rest**: Keep Leo from running or high-intensity play at school or playgrounds for the next 3 to 4 days while his lungs heal.

---

### 3. How to Give Leo His Medications
To heal the swelling and stop the wheezing over the next week:
* **Prednisolone Liquid (15 mg daily)**
  * **How to take**: Give Leo this liquid medication by mouth once every morning with breakfast for **5 days**. 
  * **Why**: This is a temporary, powerful anti-inflammatory steroid designed to rapidly reduce the swelling inside his airways and stop the cough.
* **Fluticasone (Flovent Inhaler - 44 mcg)**
  * **How to take**: Give 2 puffs of this controller inhaler twice a day (morning and night). Make sure he rinses his mouth with water and spits it out after use.
  * **Why**: This is his daily shield to prevent long-term asthma inflammation.
* **Albuterol Rescue Inhaler**
  * **How to take**: Use 2 puffs every 4 to 6 hours *as needed* if he exhibits wheezing or dry coughing.

---

### 4. 🚨 When to seek immediate emergency care
Asthma flares fluctuate. Please take Leo to the emergency room or alert emergency medical services if you see:
* Leo's chest or stomach sucking in deeply under his ribs when he tries to breathe (retractions).
* Leo is talking in short, broken words because he is too short of breath to speak full sentences.
* His lips, tongue, or fingertips appear pale or bluish.
* His Albuterol rescue inhaler makes no difference even after taking it twice.

We are taking absolute care of Leo. Keep these instructions handy, and we will follow up with you in 1 week!`;
  }

  return `### Hello ${patientName},

We have completed summarizing the details of your medical consultation. 

---

### 1. What is happening
The clinician reviewed your reported symptoms. Based on the transcript dialogue, your primary concerns are being thoroughly monitored.
* Symptom onset duration: **${ext.duration || "recent onset"}**.
* Initial symptoms evaluated: **${symptomsStr || "primary complaints"}**.
* Selected allergy profile: **${(ext.allergies || []).join(", ") || "No Known Drug Allergies (NKDA)"}**.

---

### 2. Comfort & Supportive Care
* Stay resting and drink substantial warm liquids to thin out any congestion.
* Take warm baths or breathe warm moist air to soothe dry respiratory channels.

---

### 3. Medications Planned
* Please refer to the specific clinical care plan discussed. Ensure you take all antibiotics or medications for the complete duration ordered by your primary doctor.

---

### 4. 🚨 Warning Red Flags
Please proceed immediately to the nearest urgent care or cardiac chest pain emergency department if you experience:
* Severe gasping, blue tint to lips, or sudden short of breath.
* Sudden severe slurring of speech, numbness on one side of your face, or severe weakness.
* Chronic fevers that do not respond to Standard Tylenol medication.

Stay rested and follow up with your doctor's office in 1 week.`;
}


// Simulators to guarantee functioning outputs when API key is missing or is experiencing failures:

function simulateTranscriptFormatting(rawText: string, patientName?: string) {
  const name = patientName || "Patient";
  // Attempt basic split
  const lines = rawText.split(/\n/);
  let result = "";
  let doctorIsSpeaking = true;

  for (let line of lines) {
    if (!line.trim()) continue;
    if (line.toLowerCase().includes("doctor") || line.toLowerCase().includes("dr.") || line.toLowerCase().includes("hello") && doctorIsSpeaking) {
      result += `Doctor: ${line.replace(/doctor/gi, "").trim()}\n`;
      doctorIsSpeaking = false;
    } else {
      result += `${name}: ${line.replace(/(patient|i |me )/gi, "").trim()}\n`;
      doctorIsSpeaking = true;
    }
  }

  // Fallback to scenario-based checks if it mimics typical scenarios
  if (rawText.toLowerCase().includes("chest pain") || rawText.toLowerCase().includes("angina")) {
    return `Doctor: Welcome in Mr. Harris. Please, have a seat. What brings you to the urgent care clinic today?
Mr. Harris: Thank you, doctor. Honestly, I'm quite scared. I woke up around 4:00 AM with this heavy squeezing pressure right in the middle of my chest. It felt like an elephant was standing on my breastbone.
Doctor: Oh, I see. Does that squeezing pain travel anywhere, like into your jaw, neck, or down your left arm?
Mr. Harris: Yes, actually. It's radiating straight down my left shoulder and arm. I felt quite dizzy, a bit nauseous, and broke out in cold sweats.
Doctor: Have you had any shortness of breath? And do you have any allergies?
Mr. Harris: Yes, very hard to catch my breath. I am severely allergic to Penicillin — I get a dangerous anaphylactic hives reaction. I also have high blood pressure and take some medicine for that. Oh, and I took some ibuprofen but it didn't help.
Doctor: Got it. We need an immediate ECG and cardiac enzymes. Let's get these stat. I'll listen to your chest right now.`;
  }

  if (rawText.toLowerCase().includes("cough") || rawText.toLowerCase().includes("fever")) {
    return `Doctor: Hi Ms. Patel. Let's talk about what's going on. I hear you've been unwell.
Ms. Patel: Hi Doctor. Yes, I've had a really bad wet cough for about five days now. It started as a tickle, but now I am bringing up thick yellowish phlegm.
Doctor: I see. Have you monitored your temperature? If so, does any other family member have this?
Ms. Patel: Yesterday my fever reached 101.5. I've also been feeling body aches, shivering, and extreme exhaustion. No one else has it at home. My allergies include Sulfa drugs - they cause severe rash.
Doctor: Alright, let me take a listen to your lungs. (listening...) Yes, there is some coarse crackling on the right lower base of your lungs. I'm going to prescribe you Amoxicillin 500mg, three times a day, for 7 days to cover for suspected community-acquired bacterial bronchitis.
Ms. Patel: Thank you doctor. I'll start taking it right away.`;
  }

  return result || `Doctor: Hello, please explain your condition.\nPatient: I have been feeling symptoms for a few days.\nDoctor: Let's do a complete exam and form a diagnosis.`;
}

function simulateMedicalExtraction(transcript: string) {
  const transLower = transcript.toLowerCase();
  
  if (transLower.includes("chest") || transLower.includes("elephants") || transLower.includes("harris")) {
    return {
      symptoms: ["Heavy chest squeezing pain", "Radiation to left shoulder/arm", "Dizziness", "Nausea", "Cold sweating", "Difficulty breathing / SOB"],
      medicines: [
        { name: "Ibuprofen", dosage: "Unknown", frequency: "Prn", duration: "Prior to arrival" },
        { name: "Antihypertensive medication", dosage: "Not specified", frequency: "Daily", duration: "Chronic" }
      ],
      duration: "Since 4:00 AM today (approx. 6 hours)",
      allergies: ["Penicillin (Anaphylactic hives reaction)"],
      diagnosesMentioned: ["Suspected Myocardial Infarction / Unstable Angina", "Acute Coronary Syndrome", "Hypertension"]
    };
  }

  if (transLower.includes("cough") || transLower.includes("phlegm") || transLower.includes("patel")) {
    return {
      symptoms: ["Wet cough with thick yellow phlegm", "Fever up to 101.5°F", "Shivering", "Body aches", "Extreme fatigue/exhaustion"],
      medicines: [
        { name: "Amoxicillin", dosage: "500 mg", frequency: "Three times a day", duration: "7 days" }
      ],
      duration: "5 days",
      allergies: ["Sulfa drugs (Severe rash reaction)"],
      diagnosesMentioned: ["Community-Acquired Bacterial Bronchitis", "Lobe Crackles", "Fever"]
    };
  }

  if (transLower.includes("asthma") || transLower.includes("wheezing") || transLower.includes("leo")) {
    return {
      symptoms: ["Expiratory wheezing", "Dry nighttime cough", "Shortness of breath on playground", "Nasal congestion"],
      medicines: [
        { name: "Albuterol inhaler", dosage: "2 puffs", frequency: "As needed (prn)", duration: "Chronic" },
        { name: "Fluticasone (Flovent)", dosage: "44 mcg", frequency: "Daily", duration: "Daily" }
      ],
      duration: "2 weeks flare-up",
      allergies: ["Peanuts (Severe lip swelling)"],
      diagnosesMentioned: ["Mild Persistent Asthma exacerbation", "Allergic Rhinitis"]
    };
  }

  return {
    symptoms: ["Unspecified symptom mentioned by patient"],
    medicines: [{ name: "None", dosage: "n/a", frequency: "n/a", duration: "n/a" }],
    duration: "Acute status",
    allergies: ["NKDA (No Known Drug Allergies)"],
    diagnosesMentioned: ["Observation status"]
  };
}

function simulateSoapDraft(transcript: string, extraction: any) {
  const ext = extraction || { symptoms: [], allergies: [], diagnosesMentioned: [], medicines: [] };
  const transLower = transcript.toLowerCase();

  if (transLower.includes("chest") || transLower.includes("elephants") || transLower.includes("harris")) {
    return {
      subjective: `Patient is a ${ext.patientAge || "54"}-year-old male presenting with acute, sudden-onset crushing chest pressure since 0400 today. Patient describes pain as "an elephant standing on his chest" radiating directly into the left neck, shoulder, and left arm. Associated with severe short of breath, diaphoresis, mild nausea, and feeling of impending doom. He has chronic hypertension. Allergy: Penicillin (Anaphylactic history). Taken OTC Ibuprofen without relief.`,
      objective: `General: Alert, diaphoretic, appears pale and strictly anxious.
Vitals: Blood pressure measured elevated at 155/98 mmHg on arrival. Heart rate is tachycardic at 104 bpm. Resp rate 22/min. Temp 98.6F.
Lungs: Clear to auscultation bilaterally, tachypneic but no wheezes or crackles.
Circulation: S1S2 present, fast and regular. No murmurs or gallops. Diaphoretic skin noted.`,
      assessment: `Suspected Acute Coronary Syndrome (ACS) / ST-elevation Myocardial Infarction (STEMI) vs. Unstable Angina.
Hypertension, poorly controlled.
Penicillin Allergy (High risk anaphylaxis).`,
      plan: `1. Emergency 12-lead ECG immediately.
2. Blood draw for Stat Troponin, CMP, and CBC.
3. Administer chewable Aspirin 325 mg immediately, if no bleeding history. Give Sublingual Nitroglycerin (SL NTG) 0.4mg q5min x 3 doses, monitoring BP.
4. Establish IV access, keep patient on telemetry/oxygen monitor.
5. Absolute Red Flag Netting: If ECG shows ST-segment changes, alert interventional cardiology immediately for transfer/cath lab.`
    };
  }

  // Default Pediatric/Asthma scenario or General
  if (transLower.includes("asthma") || transLower.includes("wheezing") || transLower.includes("leo")) {
    return {
      subjective: `Patient is an 8-year-old male with history of mild persistent asthma presenting with progressive respiratory shortness of breath and nighttime coughing for 2 weeks. Parents report his rescue Albuterol controller is used daily now with decreased response. Complains of difficulty breathing on the school playground. Allergy: Peanuts (Severe lip swelling).`,
      objective: `General: Co-operative child, breathing with mild accessory muscles.
Lungs: Bilateral expiratory wheezing throughout all fields. Standard chest expansion. No cynosis.
Nose: Boggy turbinates, clear rhinorrhea.
Vitals: Respiration 24/min. Heart rate 92. Temp 98.4 F. Oxygen Saturation is 94% on room air.`,
      assessment: `Mild Persistent Asthma, acute moderate exacerbation. Allergic Rhinitis flare-up.`,
      plan: `1. Administer Albuterol nebulizer 2.5mg in clinic stat. Re-check breath sounds in 20 minutes.
2. Prescribe Prednisolone 15mg daily oral liquid for 5 days.
3. Optimize daily Fluticasone (Flovent) to 2 puffs of 44mcg bid.
4. Asthma action plan revised: Albuterol inhaler q4-6h prn wheeze. Re-visit in 1 week. Contact pediatric nurse if breathing worsens.`
    };
  }

  // General Cough and Fever / Ms. Patel
  return {
    subjective: `Patient is a 32-year-old female presenting with a heavy active wet cough accompanied by production of thick, yellow sputum for 5 days. Describes subjective moderate fever peaking at 101.5°F, generalized chills, localized dull chest discomfort during coughing, and intense fatigue. Allergy: Sulfa drugs (leads to severe generalized rash).`,
    objective: `General: Conscious, shivering but cooperative. Not in acute distress.
Vitals: Temp 101.2°F (tympanic). BP 118/76 mmHg. HR 88 bpm. Resp rate 18/min. SpO2 98% on room air.
Lungs: Decreased breath sounds and localized coarse crackles in the right lower lobe base. No audible wheezes.`,
    assessment: `Community-Acquired Bronchitis, highly suspected bacterial etiology given high fever and purulent sputum. Right lower lobe pneumonia to be ruled out by clinical signs. Sulfa Drug allergy.`,
    plan: `1. Prescribe Amoxicillin 500mg PO three times daily for 7 days.
2. Advise resting, high fluid intake (2-3L/day), and OTC Acetaminophen 500mg every 6 hours prn fever/body aches.
3. Safe Netz: Return immediately or report to closest ER if severe shortness of breath, blood in cough, or fever > 103F.
4. If no resolution in 5 days, plan a Chest X-ray.`
  };
}

function simulateRagFormatting(soapNote: any, templateId: string) {
  const rawNote = soapNote || { subjective: "", objective: "", assessment: "", plan: "" };

  if (templateId === "metro_urgent") {
    // SCANNABLE BULLETED FORMAT
    return {
      subjective: `• 32yo F, present with wet productive cough x 5 days with yellow phlegm
• Subjective fever (max 101.5F yesterday), chills, and total fatigue
• Pain: Dull retrosternal chest soreness with deep coughs
• Allergy: SULFA DRUGS (Severe Rash)`,
      objective: `• Temp: 101.2F | BP: 118/76 | HR: 88 | RR: 18 | SpO2: 98%
• Gen: Alert, shivering, not in acute distress
• Resp: Coarse crackles localized in Right Lower Lobe base
• Circ: S1S2 clear, regular rate, normal perfusion`,
      assessment: `• Acute Bacterial Bronchitis (suspected community origin)
• R RLL Crackles - r/o early pneumonia
• Sulfa Drug Allergy`,
      plan: `• Rx: AMOXICILLIN 500mg PO TID x 7 days [COMPLIANT]
• Supportive: Rest, push hydration, OTC Acetaminophen 500mg q6h prn fever
• Net/RedFlag: Return if dyspnea, hemoptysis, or spiking fever > 103F`
    };
  }

  if (templateId === "apex_family") {
    // PATIENT SUMMARY AT TOP
    return {
      subjective: `*** APEX FAMILY CLINIC PATIENT CARE PLAN ***
Welcome Patient! Here is what we discussed today: You've been suffering from an intense wet cough with thick phlegm and a fever of 101.5°F for five days, leaving you very exhausted.

[CLINICAL SUBJECTIVE]
32yo Female presenting with productive wet cough x5d with yellow-tinted sputum. Reports chills, generalized myalgias, and severe fatigue. Allergies: Sulfa drugs (rash).`,
      objective: `[CLINICAL OBJECTIVE]
Tmax: 101.2 F. SpO2 98%. BP 118/76. Breath sounds reveal crackles on the bottom right chest area (right lower lobe). Heart shows regular rhythm/rate, no murmurs.`,
      assessment: `[CLINICAL DIAGNOSES FOR BILLING]
1. Community-Acquired Bronchitis (Bacterial Suspected)
2. Right Lower Lobe lung crackles (r/o Pneumonia)
3. Sulfa Allergy`,
      plan: `*** YOUR RECOVERY STEPS FOR HOME: ***
1. Take Amoxicillin 500mg pills three times every day for 1 week. Please take the full bottle even if you feel better!
2. Rest and drink plenty of warm liquids.
3. Take Acetaminophen or Tylenol 500mg for fever if needed.
4. Call our triage nurse or go to ER if breathing gets hard.

[CLINICAL PROTOCOLS]
- Amoxicillin 500mg PO TID x 7 days assigned.
- Return in 1 week for re-evaluation.`
    };
  }

  // Default / Hospital A (ST JUDE FORMAL ACADEMIC)
  return {
    subjective: `CHIEF COMPLAINT: Productive cough and fever of five days duration.
HISTORY OF PRESENT ILLNESS (HPI): The patient is an adult female who presents for clinical evaluation of a persistent coughing illness. Onset commenced five diurnal cycles ago with minor throat pruritus, which rapidly progressed into an active bronchial cough producing heavy, yellow purulent sputum. Patient further endorses thermoregulatory instability with a recorded home temperature spike of 101.5°F, accompanied by rigors, global myalgia, and significant debility. No household contacts are sick.
CONTRAINDICATED SUBSTANCES: Highly hypersensitive to Sulfa compounds, which trigger extensive cutaneous rash.`,
    objective: `VITAL SIGNS & METRIC MEASUREMENT:
- Body Temperature: 101.2°F (38.4°C)
- Systolic/Diastolic BP: 118/76 mmHg
- Myocardial Pulse Rate: 88 bpm (regular rhythm)
- Respiratory Frequency: 18 breaths/min
- Arterial Oxygen Saturation: 98% room air
PHYSICAL EXAMINATION:
- Constitutional: Patient appears tired, exhibiting physical shivering, yet answers all clinical prompts normally.
- Pulmonology exam: Bilateral breath sounds are present. Auscultation of posterior chest fields displays localized, asymmetric coarse crackles (crepitations) in the base of the right lower lobe. Retractions or wheezes are absent.`,
    assessment: `CLINICAL ASSESSMENT & DIAGNOSTIC CODES:
1. Acute Community-Acquired Bacterial Bronchitis (ICD-10 J40) - Etiology favors bacterial pathology based on sputum purulence, active crepitation, and high-degree fever.
2. Right Lower Lobe Crackles (ICD-10 R09.89) - Pneumonic process must be kept in the differential diagnostics.
3. Sulfa Drug allergy history (ICD-10 Z88.2).`,
    plan: `THERAPEUTIC INTERVENTION AND CARE DIRECTIVES:
1. Antibiotic coverage: Initiate Amoxicillin 500mg orally every 8 hours for a total course of 7 therapeutic days.
2. Supportive care measures: Maintain adequate hydration profile (optimal target 2000-3000mL daily) and complete bed rest.
3. Symptomatic relief: Administer Acetaminophen 500mg PO every 6 hours prn for febrile symptoms or uncomfortable systemic body aches. Max 3000mg/24 hours.
4. Clinician safety net: Counsel patient on warning elements including severe respiratory distress, dyspnea at rest, hemoptysis, or high fevers refractory to antipyretics. Return should match immediate emergency assistance.`
  };
}

function simulateSafetyCheck(transcript: string, extraction: any, soapNote: any) {
  const transLower = transcript.toLowerCase();
  const ext = extraction || { symptoms: [], allergies: [], medicines: [] };
  const planTxt = (soapNote && soapNote.plan) ? soapNote.plan.toLowerCase() : "";

  // Check for critical cardiac scenarios
  if (transLower.includes("chest") || transLower.includes("elephants") || transLower.includes("harris")) {
    
    // Check if penicillin is prescribed despite known severe allergy (Double safety check!)
    const isPenicillinAlert = planTxt.includes("amoxicillin") || planTxt.includes("penicillin");
    const alerts: string[] = ["CHEST PAIN ALERT: Crusher pressure right in midchest representing high risk acute coronary syndrome."];
    
    if (isPenicillinAlert) {
      alerts.push("CONTRAINDICATION ALARM: Major Penicillin Allergy identified in profile, but a Penicillin derivative (Amoxicillin/Penicillin VK) was drafted in the plan!");
    }

    return {
      isSafe: false,
      redFlagsIdentified: [
        "Crushing retrosternal chest squeeze (classic 'elephant on chest' presentation)",
        "Radiation to left shoulder, Left arm, and Neck",
        "Shortness of breath / Dyspnea at rest"
      ],
      missingDetails: [
        "Needs documentation of exact blood pressure reading check (recorded as 155/98 but not verified in first dialogue)",
        "Needs confirmation if patient took any Sildenafil/Viagra before drafting Nitroglycerin plan (critical interaction alert)"
      ],
      contraindicationsDetected: isPenicillinAlert ? ["Penicillin Allergy mapped to drafted Penicillin/Amoxicillin prescription."] : [],
      severity: "high",
      recommendations: [
        "🚨 Order Immediate Stat 12-lead ECG and Troponin blood draw immediately.",
        "⚠️ Avoid prescribing ANY penicillin/amoxicillin. Give alternatives (Macrolides/Doxycycline) if infection is suspected, but focus is cardiorespiratory life support.",
        "🛑 Screen for phosphodiesterase inhibitors (Viagra/Cialis) before administering sublingual Nitroglycerin to prevent life-threatening blood pressure drops!"
      ]
    };
  }

  // Check for cough/Patel and potential penicillin/sulfa interactions
  if (transLower.includes("cough") || transLower.includes("patel") || transLower.includes("bronchitis")) {
    
    // Check if Amoxicillin is prescribed, which is SAFE because allergy is SULFA. But let's check if doctor asks about allergy or prescribes sulfamethoxazole (trimethoprim)
    const isSulfaAllergenConflict = planTxt.includes("bactrim") || planTxt.includes("sulfa") || planTxt.includes("trimethoprim");
    
    return {
      isSafe: !isSulfaAllergenConflict,
      redFlagsIdentified: [],
      missingDetails: ["Verify if patient has documented history of COPD or asthma, as right lower lobe coarse crackles are present."],
      contraindicationsDetected: isSulfaAllergenConflict ? ["Sulfa Allergy matched with prescribed Sulfa-compound Bactrim."] : [],
      severity: isSulfaAllergenConflict ? "high" : "low",
      recommendations: isSulfaAllergenConflict 
        ? ["🚨 Allergy Conflict: Patient is highly allergic to Sulfa, switch medication immediately away from Bactrim (Trimethoprim/Sulfamethoxazole).", "Ensure client takes the complete 7-day run of Amoxicillin if kept on Amoxicillin."]
        : ["Confirm medication compliance: verify dosage and warn client to report any chest pain during hard coughs.", "Safety net: instruct patient to check back if symptoms do not start clearing up within 72 hours."]
    };
  }

  // Default normal safety check
  return {
    isSafe: true,
    redFlagsIdentified: [],
    missingDetails: [],
    contraindicationsDetected: [],
    severity: "low",
    recommendations: ["Encourage complete documentation audit.", "Double check dosage standards."]
  };
}


// Integrate Vite build and SSR middleware handling
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    // Mount Vite middleware so static react files and assets compile in real time on dev
    app.use(vite.middlewares);
  } else {
    // Serve static compiled app files in production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port http://0.0.0.0:${PORT}`);
  });
}

startServer();
