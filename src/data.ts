import { Scenario, HospitalTemplate } from "./types";

export const HOSPITAL_TEMPLATES: HospitalTemplate[] = [
  {
    id: "st_jude",
    name: "St. Jude Hospital Protocol",
    facility: "St. Jude Clinical Research Hosp.",
    styleDescription: "Formal, academic terminology matching ICD-10 clinical classifications.",
    promptGuideline: "Format the SOAP note with highly formal, academic medical terminology. Use ICD-10 styled phrasing. Include dedicated sub-headings like 'History of Present Illness (HPI)', 'Vitals/Physical Signs under Objective', 'Differential Diagnosis under Assessment', and 'Therapeutic Plan under Plan'."
  },
  {
    id: "metro_urgent",
    name: "Metro Health Urgent Care",
    facility: "Metro General Urgent Clinic",
    styleDescription: "Fast, concise bullet points optimal for emergency care providers.",
    promptGuideline: "Format the SOAP note to be extremely concise. Use bullet points for easy scannability by fast-paced ER/Urgent Care doctors. Do not write full paragraphs. Focus purely on immediate action items, key symptoms, and active medications."
  },
  {
    id: "apex_family",
    name: "Apex Family Medicine",
    facility: "Apex Integrated Primary Care",
    styleDescription: "Friendly community practice focusing on follow-up tracking.",
    promptGuideline: "Prioritize patient-friendly summaries and follow-ups. Place a patient-readable 'Brief Summary for Patient' section at the top of the Plan. State everything in clear, non-jargon terms alongside standard medical jargon."
  }
];

export const PRESET_SCENARIOS: Scenario[] = [
  {
    id: "cough_fever",
    title: "Acute Cough & Persistent Chest Congestion",
    specialty: "Infectious Disease / Family Med",
    patientName: "Aaliyah Patel",
    patientAge: "32",
    description: "Ms. Patel presents with worsening chest congestion, green-yellow phlegm, chills, and high fever peaking at 101.5°F. She has a documented severe Sulfa Allergy.",
    rawSampleTranscript: "Hello doctor. I've had a really bad wet cough for about five days now. It started as a tickle, but now I'm bringing up thick yellowish phlegm. Yesterday my fever reached 101.5 degrees. I've also been feeling body aches, shivering, and extreme exhaustion. No one else has it at home. My allergies include Sulfa drugs — they cause a severe skin rash.",
    expectedRedFlags: ["High fever", "Yellow sputum", "Coarse crepitations in lung base"]
  },
  {
    id: "chest_pain_emergency",
    title: "Emergency Crushing Chest Pressure (High Risk)",
    specialty: "Cardiology / Emergency Dept",
    patientName: "Robert Harris",
    patientAge: "58",
    description: "Mr. Harris experiences sudden heavy squeezing chest pain radiating to his left shoulder and arm since 4:00 AM. He has a history of high blood pressure and is severely allergic to Penicillin.",
    rawSampleTranscript: "Thank you, doctor. Honestly, I'm quite scared. I woke up around 4:00 AM with this heavy squeezing pressure right in the middle of my chest. It felt like an elephant was standing on my breastbone. It's radiating straight down my left shoulder and arm. I felt quite dizzy, a bit nauseous, and broke out in cold sweats. Yes, very hard to catch my breath. I am severely allergic to Penicillin — I get a dangerous anaphylactic hives reaction. I also have high blood pressure and take some medicine for that. Oh, and I took some ibuprofen but it didn't help.",
    expectedRedFlags: ["Crushing chest pain radiating to arm", "Severe shortness of breath", "Penicillin allergy contraindication"]
  },
  {
    id: "asthma_pediatric",
    title: "Leo Martinez - Expiratory Wheezing Episode",
    specialty: "Pediatrics / Pulmonology",
    patientName: "Leo Martinez",
    patientAge: "8",
    description: "An 8-year-old child presenting with progressive difficulty breathing on playgrounds, dry nighttime cough, and active exhalation wheezing. Known severe Peanut Allergy.",
    rawSampleTranscript: "Hi Dr. Ramirez, I'm bringing Leo in because his breathing has been very noisy and tight. He's had a dry night cough for two weeks and got really short of breath on the playground yesterday. He's been using his quick Albuterol rescue inhaler every single day now, but it doesn't seem to last long. He also has nasal stuffiness and is allergic to peanuts — they make his lips swell up severely.",
    expectedRedFlags: ["Active expiratory wheezing", "Daily rescue inhaler reliance", "Peanut anaphylaxis history"]
  }
];
