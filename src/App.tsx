import React, { useState, useEffect, useRef } from "react";
import { 
  motion, 
  AnimatePresence 
} from "motion/react";
import { 
  Mic, 
  MicOff, 
  Play, 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  Building2, 
  ShieldAlert, 
  ClipboardCheck, 
  RefreshCw, 
  Copy, 
  Check, 
  HeartPulse, 
  Stethoscope,
  HelpCircle,
  Download,
  User,
  Activity,
  FileCheck2,
  Hourglass
} from "lucide-react";
import { 
  Scenario, 
  HospitalTemplate,
  ExtractedData,
  SoapNote,
  SafetyCheck
} from "./types";
import { PRESET_SCENARIOS, HOSPITAL_TEMPLATES } from "./data";

export default function App() {
  // Scenario states
  const [scenarios] = useState<Scenario[]>(PRESET_SCENARIOS);
  const [selectedScenario, setSelectedScenario] = useState<Scenario>(PRESET_SCENARIOS[0]);
  const [selectedTemplate, setSelectedTemplate] = useState<HospitalTemplate>(HOSPITAL_TEMPLATES[2]); // Default to Apex Family (patient summary focus)
  
  // Patient fields
  const [patientName, setPatientName] = useState(PRESET_SCENARIOS[0].patientName);
  const [patientAge, setPatientAge] = useState(PRESET_SCENARIOS[0].patientAge);
  const [rawText, setRawText] = useState(PRESET_SCENARIOS[0].rawSampleTranscript);
  const [isRecording, setIsRecording] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);

  // Active generation output states
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(-1);
  const [generationSource, setGenerationSource] = useState<string>("simulation");
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // Completed products
  const [transcriptData, setTranscriptData] = useState<string>("");
  const [extractionData, setExtractionData] = useState<ExtractedData | null>(null);
  const [formattedSoapNote, setFormattedSoapNote] = useState<SoapNote | null>(null);
  const [safetyCheckResult, setSafetyCheckResult] = useState<SafetyCheck | null>(null);
  const [patientSummary, setPatientSummary] = useState<string>("");
  const [isApproved, setIsApproved] = useState(false);
  const [activeTab, setActiveTab] = useState<"patient" | "clinician">("patient");

  // Step definitions for the sequential clinical pipeline
  const pipelineSteps = [
    { label: "Refining Dialogue Transcript", desc: "Speaker separation and linguistic noise reduction" },
    { label: "Extracting Clinical Entities", desc: "NER analysis for symptoms, dosages, and drug allergies" },
    { label: "Drafting S.O.A.P Record", desc: "Synthesizing professional subjective and objective findings" },
    { label: "Aligning Hospital Guidelines", desc: "Applying clinical formatting style and protocols" },
    { label: "Conducting Safety Audits", desc: "Drug-allergy checks and red flag contraindication scanning" },
    { label: "Compiling Patient Summary", desc: "Translating medical findings into kind, patient-friendly terms" }
  ];

  // Speech Recognition hook
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Initialise Speech Recognition if supported
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onresult = (event: any) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + " ";
          }
        }
        if (finalTranscript) {
          setRawText(prev => prev + (prev.trim() === "" ? "" : " ") + finalTranscript.trim());
        }
      };

      rec.onerror = (e: any) => {
        console.error("Speech recognition error:", e);
        setSpeechError("Microphone system or browser Speech API unavailable.");
      };

      recognitionRef.current = rec;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert("Voice transcription is designed for modern browsers (Chrome/Safari). Please select a preset patient case or type directly inside the consult dialog!");
      return;
    }
    setSpeechError(null);
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      setIsRecording(true);
      setRawText("");
      recognitionRef.current.start();
    }
  };

  const handleScenarioChange = (scen: Scenario) => {
    setSelectedScenario(scen);
    setPatientName(scen.patientName);
    setPatientAge(scen.patientAge);
    setRawText(scen.rawSampleTranscript);
    resetPipeline();
  };

  const resetPipeline = () => {
    setIsProcessing(false);
    setActiveStepIndex(-1);
    setIsApproved(false);
    setTranscriptData("");
    setExtractionData(null);
    setFormattedSoapNote(null);
    setSafetyCheckResult(null);
    setPatientSummary("");
    setActiveTab("patient");
  };

  // Run the clinical scribe agents pipeline sequentially
  const runScribePipeline = async () => {
    if (!rawText || !rawText.trim()) {
      alert("Please choose a patient preset or record a consultation transcript first!");
      return;
    }

    resetPipeline();
    setIsProcessing(true);
    setActiveStepIndex(0);

    const stepDelay = () => new Promise(res => setTimeout(res, 150));

    try {
      // Step 1: Refining Dialogue Transcript
      await stepDelay();
      const transcriptResponse = await fetch("/api/agent/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText, patientName, patientAge })
      });
      const tData = await transcriptResponse.json();
      const refinedTranscript = tData.transcript;
      setTranscriptData(refinedTranscript);
      setGenerationSource(tData.source);
      setActiveStepIndex(1);

      // Step 2: Extracting Clinical Entities
      await stepDelay();
      const extractionResponse = await fetch("/api/agent/extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: refinedTranscript })
      });
      const eData = await extractionResponse.json();
      setExtractionData(eData.extraction);
      setActiveStepIndex(2);

      // Step 3: Drafting SOAP Record
      await stepDelay();
      const soapResponse = await fetch("/api/agent/soap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: refinedTranscript, extraction: eData.extraction })
      });
      const sData = await soapResponse.json();
      setActiveStepIndex(3);

      // Step 4: Aligning Hospital Guidelines
      await stepDelay();
      const ragResponse = await fetch("/api/agent/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soapNote: sData.soap,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          promptGuideline: selectedTemplate.promptGuideline
        })
      });
      const rData = await ragResponse.json();
      setFormattedSoapNote(rData.soapFormatted);
      setActiveStepIndex(4);

      // Step 5: Clinical Safety Audit
      await stepDelay();
      const safetyResponse = await fetch("/api/agent/safety", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: refinedTranscript,
          extraction: eData.extraction,
          soapNote: rData.soapFormatted
        })
      });
      const safData = await safetyResponse.json();
      setSafetyCheckResult(safData.safety);
      setActiveStepIndex(5);

      // Step 6: Compiling Patient Layman Summary
      await stepDelay();
      const laymanResponse = await fetch("/api/agent/layman", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName,
          extraction: eData.extraction,
          soapNote: rData.soapFormatted
        })
      });
      const layData = await laymanResponse.json();
      setPatientSummary(layData.summary);

      // All steps finished
      await stepDelay();
      setIsProcessing(false);
      setActiveStepIndex(6);

    } catch (err: any) {
      console.error(err);
      alert("We encountered an error during automated agent pipelining: " + err.message);
      setIsProcessing(false);
    }
  };

  const handleSoapEdit = (section: keyof SoapNote, value: string) => {
    if (!formattedSoapNote) return;
    setFormattedSoapNote({
      ...formattedSoapNote,
      [section]: value
    });
  };

  // Electronic Signature / Log Note
  const handleApproveNote = () => {
    setIsApproved(true);
  };

  // Native File Downloader
  const handleDownloadFile = (type: "patient" | "clinician" | "composite") => {
    let filename = "";
    let content = "";
    const cleanPatientName = patientName.replace(/\s+/g, "_");

    if (type === "patient") {
      filename = `Patient_Health_Summary_${cleanPatientName}.txt`;
      content = `========================================================
PATIENT HEALTH REPORT & CONSULTATION OVERVIEW
========================================================
Patient Name: ${patientName}
Date of Consultation: ${new Date().toLocaleDateString()}
Facilitating Clinic: ${selectedTemplate.facility}

${patientSummary.replace(/###/g, "").replace(/\*\*/g, "")}`;
    } else if (type === "clinician") {
      filename = `Clinical_SOAP_Note_${cleanPatientName}.txt`;
      content = `========================================================
CLINICAL SOAP ENCOUNTER NOTE - SIGNED RECORD
========================================================
Patient Name: ${patientName}
Age: ${patientAge}
Encounter Date: ${new Date().toLocaleDateString()}
Clinic Style: ${selectedTemplate.name}

--------------------------------------------------------
[S] SUBJECTIVE FINDINGS:
--------------------------------------------------------
${formattedSoapNote?.subjective || ""}

--------------------------------------------------------
[O] OBJECTIVE FINDINGS & VITALS:
--------------------------------------------------------
${formattedSoapNote?.objective || ""}

--------------------------------------------------------
[A] CLINICAL ASSESSMENT:
--------------------------------------------------------
${formattedSoapNote?.assessment || ""}

--------------------------------------------------------
[P] CLINICAL CARE PLAN & PRESCRIPTIONS:
--------------------------------------------------------
${formattedSoapNote?.plan || ""}

--------------------------------------------------------
SAFETY AUDIT GATE CHECK:
--------------------------------------------------------
Risk Severity: ${safetyCheckResult?.severity.toUpperCase() || "LOW"}
Red Flags Identified: ${safetyCheckResult?.redFlagsIdentified.join(", ") || "None"}
Clinician Approver: Signed Electronically by Consulting Physician.`;
    } else {
      filename = `Complete_Encounter_Dossier_${cleanPatientName}.txt`;
      content = `========================================================
COMPLETE PATIENT ENCOUNTER DOSSIER - NEURAL SCRIBE
========================================================
Patient Name: ${patientName}
Age: ${patientAge}
Date: ${new Date().toLocaleDateString()}
Aligning Protocol: ${selectedTemplate.name}

========================================================
SECTION I: PATIENT-FRIENDLY RECOVERY & CARE GUIDE
========================================================
${patientSummary.replace(/###/g, "").replace(/\*\*/g, "")}

========================================================
SECTION II: CONFIDENTIAL CLINICAL SOAP NOTE
========================================================
[S] SUBJECTIVE:
${formattedSoapNote?.subjective || ""}

[O] OBJECTIVE:
${formattedSoapNote?.objective || ""}

[A] ASSESSMENT:
${formattedSoapNote?.assessment || ""}

[P] PLAN:
${formattedSoapNote?.plan || ""}

--------------------------------------------------------
SAFETY GATE LOGS:
${safetyCheckResult?.isSafe ? "Safety Compliance Approved" : "Safety Flags Logged"}
Identified Red Flags: ${safetyCheckResult?.redFlagsIdentified.join("; ") || "Cleared"}
Drug Allergies Logged: ${extractionData?.allergies.join(", ") || "None"}
Electronic Lock Signature Released: ${isApproved ? "YES (Signed)" : "PENDING PHYSICIAN OVERRIDE"}`;
    }

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="min-h-screen bg-[#070709] text-zinc-300 font-sans antialiased selection:bg-zinc-800 selection:text-white" id="neural_scribe_app">
      
      {/* Top Header - Inspired by neuralhub.us ultra-clean layout */}
      <header className="border-b border-zinc-900 bg-black/60 backdrop-blur-md sticky top-0 z-50 px-6 py-4" id="minimal_header_bar">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-sm font-display font-semibold tracking-wider text-white uppercase">NeuralScribe</h1>
            <span className="text-[10px] font-mono text-zinc-650 border border-zinc-850 px-2 py-0.5 rounded text-neutral-400">
              Clinical Co-Pilot
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-zinc-500">
            <span>Model: <b className="text-zinc-200">{generationSource === "simulation_engine" ? "Simulated Fallback" : "Gemini 3.5"}</b></span>
            <span className="hidden md:inline text-zinc-700">|</span>
            <span className="hidden md:inline">2026-06-05</span>
          </div>

        </div>
      </header>

      {/* Main Single Screen Layout Container */}
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8" id="scribe_dashboard_body">
        
        {/* Core Description Title */}
        <div className="space-y-2 text-center md:text-left">
          <h2 className="text-2xl font-display font-medium text-white tracking-tight">Ambient Consultation Scribe</h2>
          <p className="text-xs text-zinc-500 max-w-2xl leading-relaxed">
            Record patient-clinician conversations live or select from verified preset case transcripts. 
            Six specialized medical agents collaborate sequentially to formulate clean SOAP charts, run safety audits, and compile crystal-clear recovery guidelines for patients.
          </p>
        </div>

        {/* Prescription Setup Cards / Selectors */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-6" id="input_controllers_grid">
          
          {/* Preset Patient select strip */}
          <div className="md:col-span-12 space-y-3">
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">Select Patient Preset Case</span>
            <div className="flex flex-wrap gap-2" id="preset_scenarios_strip">
              {scenarios.map((scen) => {
                const isSelected = selectedScenario.id === scen.id;
                return (
                  <button
                    key={scen.id}
                    onClick={() => handleScenarioChange(scen)}
                    className={`px-3 py-2 text-xs rounded-lg border transition-all duration-250 font-medium ${
                      isSelected 
                        ? "bg-white text-black border-white shadow-md shadow-white/5" 
                        : "bg-zinc-950/40 hover:bg-zinc-900 border-zinc-900 text-zinc-400 hover:text-zinc-200"
                    }`}
                    id={`case_selector_${scen.id}`}
                  >
                    {scen.patientName} • <span className="opacity-75">{scen.title}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Left Block: Demographics & Transcript Input (7 cols on desktop) */}
          <div className="md:col-span-8 bg-black border border-zinc-900 rounded-xl p-5 space-y-4 shadow-xl" id="encounter_input_envelope">
            
            <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
              <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">1. Patient Consult Input</span>
              {isRecording && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono bg-rose-950/40 text-rose-400 border border-rose-900/40">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
                  <span>Listening Live</span>
                </span>
              )}
            </div>

            {/* Micro fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-mono text-zinc-500 uppercase mb-1">Patient Name</label>
                <input 
                  type="text" 
                  value={patientName} 
                  onChange={(e) => setPatientName(e.target.value)}
                  className="w-full text-xs bg-zinc-950 border border-zinc-900 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-700 font-medium"
                />
              </div>
              
              <div>
                <label className="block text-[10px] font-mono text-zinc-500 uppercase mb-1">Age</label>
                <input 
                  type="text" 
                  value={patientAge} 
                  onChange={(e) => setPatientAge(e.target.value)}
                  className="w-full text-xs bg-zinc-950 border border-zinc-900 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-700 font-medium"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-zinc-500 uppercase mb-1">Hospital Guidelines</label>
                <select 
                  value={selectedTemplate.id}
                  onChange={(e) => {
                    const matched = HOSPITAL_TEMPLATES.find(t => t.id === e.target.value);
                    if (matched) setSelectedTemplate(matched);
                  }}
                  className="w-full text-xs bg-zinc-950 border border-zinc-900 text-white rounded-lg px-2 py-2 focus:outline-none focus:border-zinc-700 font-medium"
                >
                  {HOSPITAL_TEMPLATES.map(temp => (
                    <option key={temp.id} value={temp.id}>{temp.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Conversation Dialog Area */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono text-zinc-500 uppercase">Consult Conversation & Transcript</label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Say something or modify the loaded consultation script here..."
                className="w-full h-44 bg-zinc-950 text-xs font-mono text-zinc-300 rounded-lg p-3.5 border border-zinc-900 focus:outline-none focus:border-zinc-700 leading-relaxed resize-none"
                id="dialogue_transcript_textarea"
              />
            </div>

            {/* Minimal controls row */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={toggleRecording}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-xs font-medium transition duration-200 ${
                  isRecording 
                    ? "bg-rose-950/20 text-rose-400 border-rose-950 hover:bg-rose-950/40" 
                    : "bg-zinc-950 text-zinc-300 border-zinc-900 hover:bg-zinc-900"
                }`}
                id="mic_trigger_action"
              >
                {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-500" />}
                <span>{isRecording ? "Stop Dictation" : "Dictate Consult"}</span>
              </button>

              <button
                onClick={runScribePipeline}
                disabled={isProcessing || !rawText.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-white text-black hover:bg-zinc-200 transition font-semibold text-xs disabled:opacity-50"
                id="trigger_scribe_action"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing Notes...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-black stroke-none" />
                    <span>Synthesize Clinical Dossier</span>
                  </>
                )}
              </button>
            </div>

          </div>

          {/* Right Block: Sequential Agent Status Timeline (4 cols on desktop) */}
          <div className="md:col-span-4 bg-black border border-zinc-900 rounded-xl p-5 flex flex-col justify-between shadow-xl" id="agent_timeline_card">
            
            <div className="space-y-4">
              <div className="border-b border-zinc-900 pb-3">
                <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest block">2. Medical Agent Pipeline</span>
              </div>

              {/* Steps progression layout */}
              <div className="space-y-3">
                {pipelineSteps.map((step, idx) => {
                  const isCurrent = idx === activeStepIndex && isProcessing;
                  const isDone = idx < activeStepIndex || (activeStepIndex === 5 && !isProcessing && patientSummary);
                  const isPending = idx > activeStepIndex && isProcessing;
                  const isIdle = !isProcessing && !patientSummary;

                  return (
                    <div 
                      key={idx}
                      className={`flex items-start gap-3 transition-opacity duration-300 ${
                        isCurrent ? "opacity-100" : isDone ? "opacity-95" : isPending ? "opacity-40" : "opacity-50"
                      }`}
                    >
                      <div className="pt-0.5">
                        {isDone ? (
                          <div className="h-4 w-4 rounded-full bg-emerald-500/10 border border-emerald-500 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-emerald-400" />
                          </div>
                        ) : isCurrent ? (
                          <div className="h-4 w-4 rounded-full border border-zinc-400 flex items-center justify-center">
                            <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                          </div>
                        ) : (
                          <div className="h-4 w-4 rounded-full border border-zinc-900 flex items-center justify-center bg-zinc-950">
                            <span className="text-[8px] font-mono text-zinc-600">{idx + 1}</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <span className={`text-[11px] font-medium block leading-none ${isCurrent ? "text-white" : isDone ? "text-zinc-300" : "text-zinc-500"}`}>
                          {step.label}
                        </span>
                        <span className="text-[9px] text-zinc-550 block mt-0.5 text-zinc-500 leading-snug">
                          {step.desc}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Status bar */}
            <div className="pt-4 border-t border-zinc-900 mt-4 text-[10.5px] font-mono text-zinc-500 flex items-center justify-between">
              <span>System Status:</span>
              <span>
                {isProcessing ? (
                  <span className="text-emerald-400 animate-pulse font-semibold">Generating...</span>
                ) : patientSummary ? (
                  <span className="text-emerald-400 font-semibold">Finished</span>
                ) : (
                  <span className="text-zinc-600">Idle Standby</span>
                )}
              </span>
            </div>

          </div>

        </section>

        {/* Dynamic Outputs Area (Shows once compiled) */}
        <AnimatePresence>
          {patientSummary ? (
            <motion.section 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
              id="synthesized_output_section"
            >
              
              {/* Tabs Controller */}
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                <div className="flex gap-4">
                  <button
                    onClick={() => setActiveTab("patient")}
                    className={`pb-2.5 text-xs font-semibold uppercase tracking-wider relative transition-colors ${
                      activeTab === "patient" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                    }`}
                    id="trigger_patient_tab"
                  >
                    <span>Patient Health Summary</span>
                    {activeTab === "patient" && (
                      <motion.div layoutId="active_tab_border" className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                    )}
                  </button>

                  <button
                    onClick={() => setActiveTab("clinician")}
                    className={`pb-2.5 text-xs font-semibold uppercase tracking-wider relative transition-colors ${
                      activeTab === "clinician" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                    }`}
                    id="trigger_clinician_tab"
                  >
                    <span>Physician SOAP Chart</span>
                    {activeTab === "clinician" && (
                      <motion.div layoutId="active_tab_border" className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                    )}
                  </button>
                </div>

                {/* Micro Action Bar */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-500 hidden md:inline">
                    Locked Records
                  </span>
                </div>
              </div>

              {/* Output Tab Content */}
              <div className="grid grid-cols-1 gap-6">
                
                {/* 1. Patient Layman Summary View */}
                {activeTab === "patient" && (
                  <div className="bg-black border border-zinc-900 rounded-xl p-6 md:p-8 space-y-6 relative overflow-hidden" id="patient_health_summary_tab">
                    
                    {/* Corner accent glow */}
                    <div className="absolute -top-12 -right-12 h-24 w-24 bg-emerald-500/5 rounded-full blur-xl pointer-events-none" />

                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-900 pb-4">
                      <div>
                        <h3 className="text-lg font-display text-white font-medium">Hello {patientName},</h3>
                        <p className="text-xs text-zinc-500">Your health review and practical recovery guideline based on today&apos;s consult</p>
                      </div>

                      {/* Download Button */}
                      <button
                        onClick={() => handleDownloadFile("patient")}
                        className="self-start md:self-center bg-white hover:bg-zinc-200 text-black font-semibold text-xs px-4 py-2.5 rounded-lg flex items-center gap-2 transition"
                        id="download_patient_report_btn"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Patient Report (.txt)</span>
                      </button>
                    </div>

                    {/* Patient-Friendly Summary Content Block */}
                    <div className="prose prose-invert max-w-full text-xs text-zinc-300 leading-relaxed font-sans space-y-5" id="layman_report_viewport">
                      {patientSummary.split("\n\n").map((chunk, index) => {
                        if (chunk.trim().startsWith("###")) {
                          return (
                            <h4 key={index} className="text-sm font-semibold font-display text-white mt-4 border-b border-zinc-950 pb-1">
                              {chunk.replace(/###/g, "").trim()}
                            </h4>
                          );
                        }
                        if (chunk.trim().startsWith("*")) {
                          return (
                            <ul key={index} className="list-disc pl-4 space-y-1.5">
                              {chunk.split("\n").map((li, lIdx) => (
                                <li key={lIdx} className="text-zinc-300">
                                  {li.replace(/^\*\s*/, "").replace(/\*\*/g, "").trim()}
                                </li>
                              ))}
                            </ul>
                          );
                        }
                        return (
                          <p key={index} className="text-zinc-300">
                            {chunk.replace(/\*\*/g, "").trim()}
                          </p>
                        );
                      })}
                    </div>

                    {/* Clean Footer Card */}
                    <div className="bg-zinc-950 border border-zinc-900 p-4 rounded-xl flex items-center gap-3 mt-6">
                      <Hourglass className="w-4 h-4 text-zinc-500" />
                      <p className="text-[11px] text-zinc-400">
                        This summary simplifies complex medical observations into plain conversational guidance. Please share this with your caregivers or keep a digital copy handy during your recovery.
                      </p>
                    </div>

                  </div>
                )}

                {/* 2. Clinician SOAP Notes Tab */}
                {activeTab === "clinician" && (
                  <div className="space-y-6" id="clinician_soap_section">
                    
                    {/* Safety Warnings Banner at top of Clinician note */}
                    {safetyCheckResult && (
                      <div className={`p-4 rounded-xl border flex items-start gap-3 ${
                        safetyCheckResult.isSafe 
                          ? "bg-emerald-950/20 border-emerald-900/60 text-emerald-400" 
                          : "bg-amber-950/20 border-amber-900/60 text-amber-500"
                      }`} id="clinical_safety_interlock_card">
                        <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                        <div className="text-xs space-y-1">
                          <span className="font-bold text-white block">Clinical Safety Interlock Audit</span>
                          <p className="text-zinc-400">
                            {safetyCheckResult.isSafe 
                              ? "Excellent. Automated safety scanners detected no acute drug-allergy contraindications or critical omissions in this draft." 
                              : "Review Clinical Risks: The active plan has been flagged with potential drug-allergy contraindications or omissions."}
                          </p>
                          {safetyCheckResult.redFlagsIdentified.length > 0 && (
                            <div className="mt-2 text-[11px] text-rose-400 font-medium">
                              <b>Immediate Alert Issues:</b> {safetyCheckResult.redFlagsIdentified.join("; ")}
                            </div>
                          )}
                          {safetyCheckResult.recommendations.length > 0 && (
                            <div className="mt-1 text-[11px] text-zinc-300">
                              <b>Audit Advice:</b> {safetyCheckResult.recommendations.join(" • ")}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* SOAP Grid & Editor */}
                    <div className="bg-black border border-zinc-900 rounded-xl p-5 md:p-6 space-y-5" id="clinical_soap_note_card">
                      
                      <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-zinc-900 gap-3">
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Doctor&apos;s Integrated SOAP Note</h3>
                          <p className="text-[10.5px] text-zinc-550 text-zinc-500">Drafted via template: <b className="text-zinc-300">{selectedTemplate.name}</b></p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDownloadFile("clinician")}
                            className="bg-zinc-900 text-zinc-200 border border-zinc-800 hover:bg-zinc-800 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-2 transition"
                            id="download_soap_doc_btn"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download SOAP (.txt)</span>
                          </button>

                          <button
                            onClick={() => handleDownloadFile("composite")}
                            className="bg-white text-black hover:bg-zinc-200 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-2 transition"
                            id="download_complete_file_btn"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download Full Dossier (.txt)</span>
                          </button>
                        </div>
                      </div>

                      {formattedSoapNote ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5" id="editable_soap_editor">
                          
                          {/* Subjective */}
                          <div className="space-y-1.5">
                            <label className="text-[10.5px] font-mono tracking-wider font-semibold text-zinc-400 block uppercase">[S] Subjective Findings</label>
                            <textarea
                              value={formattedSoapNote.subjective}
                              onChange={(e) => handleSoapEdit("subjective", e.target.value)}
                              disabled={isApproved}
                              className="w-full h-40 bg-zinc-950 text-xs text-zinc-300 rounded-lg p-3 border border-zinc-900 focus:outline-none focus:border-zinc-700 leading-relaxed disabled:opacity-75 resize-y"
                            />
                          </div>

                          {/* Objective */}
                          <div className="space-y-1.5">
                            <label className="text-[10.5px] font-mono tracking-wider font-semibold text-zinc-400 block uppercase">[O] Objective Metrics</label>
                            <textarea
                              value={formattedSoapNote.objective}
                              onChange={(e) => handleSoapEdit("objective", e.target.value)}
                              disabled={isApproved}
                              className="w-full h-40 bg-zinc-950 text-xs text-zinc-300 rounded-lg p-3 border border-zinc-900 focus:outline-none focus:border-zinc-700 leading-relaxed disabled:opacity-75 resize-y"
                            />
                          </div>

                          {/* Assessment */}
                          <div className="space-y-1.5">
                            <label className="text-[10.5px] font-mono tracking-wider font-semibold text-zinc-400 block uppercase">[A] Diagnosis & Code Assessment</label>
                            <textarea
                              value={formattedSoapNote.assessment}
                              onChange={(e) => handleSoapEdit("assessment", e.target.value)}
                              disabled={isApproved}
                              className="w-full h-40 bg-zinc-950 text-xs text-zinc-300 rounded-lg p-3 border border-zinc-900 focus:outline-none focus:border-zinc-700 leading-relaxed disabled:opacity-75 resize-y"
                            />
                          </div>

                          {/* Plan */}
                          <div className="space-y-1.5">
                            <label className="text-[10.5px] font-mono tracking-wider font-semibold text-zinc-400 block uppercase">[P] Comprehensive Treatment Plan</label>
                            <textarea
                              value={formattedSoapNote.plan}
                              onChange={(e) => handleSoapEdit("plan", e.target.value)}
                              disabled={isApproved}
                              className="w-full h-40 bg-zinc-950 text-xs text-zinc-300 rounded-lg p-3 border border-zinc-900 focus:outline-none focus:border-zinc-700 leading-relaxed disabled:opacity-75 resize-y"
                            />
                          </div>

                        </div>
                      ) : (
                        <div className="py-12 text-center text-zinc-650" id="soap_standby_loader">
                          <Hourglass className="w-8 h-8 animate-spin mx-auto text-zinc-800" />
                          <p className="text-xs text-zinc-500 mt-2">Formatting SOAP document structure...</p>
                        </div>
                      )}

                      {/* Doctor Signature Block */}
                      <div className="pt-4 border-t border-zinc-900 flex justify-between items-center bg-zinc-950/20 p-3 rounded-lg mt-4">
                        <div className="text-[11px] text-zinc-400">
                          Review and sign the document record. Signing locks the chart in patient files.
                        </div>

                        {!isApproved ? (
                          <button
                            onClick={handleApproveNote}
                            className="bg-white hover:bg-zinc-200 text-black text-xs font-semibold px-4 py-2 rounded-lg transition"
                            id="sign_and_close_encounter"
                          >
                            Sign and Appraise Chart
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/30 border border-emerald-800 text-emerald-400 rounded-lg text-xs font-semibold">
                            <Check className="w-3.5 h-3.5" />
                            <span>Signed Electronically</span>
                          </div>
                        )}
                      </div>

                    </div>

                  </div>
                )}

              </div>

            </motion.section>
          ) : (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-16 text-center border border-dashed border-zinc-900 rounded-xl space-y-3 bg-black/10"
              id="idle_welcome_panel"
            >
              <Stethoscope className="w-12 h-12 mx-auto text-zinc-800" />
              <div className="space-y-1">
                <p className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">Awaiting Consultation Data Ingestion</p>
                <p className="text-[11px] text-zinc-600 max-w-sm mx-auto">
                  Click &apos;Synthesize Clinical Dossier&apos; above or record conversation directly to initiate the automated clinical scribing agents.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* Elegant Footer Details */}
      <footer className="border-t border-zinc-900 py-10 mt-12 bg-black" id="minimal_app_footer">
        <div className="max-w-6xl mx-auto px-6 text-center md:text-left flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">NeuralScribe Ambient Interface v2.5</span>
          </div>
          <p className="text-[11px] text-zinc-600">
            Secure HIPAA-compliant clinical drafting co-pilot. All raw speech processed locally or via private, non-retained GenAI proxy gates.
          </p>
        </div>
      </footer>

    </div>
  );
}
