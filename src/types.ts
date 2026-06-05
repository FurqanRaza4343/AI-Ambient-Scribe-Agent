export interface ExtractedData {
  symptoms: string[];
  medicines: Array<{
    name: string;
    dosage?: string;
    frequency?: string;
    duration?: string;
  }>;
  duration: string;
  allergies: string[];
  diagnosesMentioned: string[];
}

export interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface SafetyCheck {
  isSafe: boolean;
  redFlagsIdentified: string[];
  missingDetails: string[];
  contraindicationsDetected: string[];
  severity: "low" | "medium" | "high";
  recommendations: string[];
}

export type AgentId = 
  | "transcript"
  | "extraction"
  | "soap"
  | "rag"
  | "safety"
  | "human_review";

export type AgentStatus = "idle" | "working" | "completed" | "error";

export interface AgentConfig {
  id: AgentId;
  name: string;
  title: string;
  description: string;
  icon: string;
  status: AgentStatus;
  output: any;
  log: string[];
}

export interface HospitalTemplate {
  id: string;
  name: string;
  facility: string;
  styleDescription: string;
  promptGuideline: string;
}

export interface SavedEncounter {
  id: string;
  patientName: string;
  date: string;
  transcript: string;
  extraction: ExtractedData;
  soapOriginal: SoapNote;
  soapFormatted: SoapNote;
  hospitalTemplateId: string;
  safety: SafetyCheck;
  approved: boolean;
  approvedAt?: string;
  notes?: string;
  laymanSummary?: string;
}

export interface Scenario {
  id: string;
  title: string;
  specialty: string;
  description: string;
  rawSampleTranscript: string;
  patientName: string;
  patientAge: string;
  expectedRedFlags: string[];
}
