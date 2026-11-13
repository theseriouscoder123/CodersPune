export type InterviewQuestion = {
  id: string;
  kind: "missing" | "conflict" | "custom";
  position: number;
  question: string;
  context: string | null;
  options: { claim_id: string; text: string; ref: string | null }[];
  answer: string | null;
  answer_kind: "answered" | "chose_option" | "dont_know" | "ask_other" | null;
  answered_at: string | null;
  ask_who: string | null;
  chosen_claim_id: string | null;
  conflict_group_id: string | null;
  conflict_resolved: boolean;
  testimony_claim_id: string | null;
};

export type InterviewView = {
  id: string;
  status: "draft" | "sent" | "submitted" | "closed";
  on_behalf: boolean;
  respondent: { id: string | null; name: string };
  created_by: string;
  sent_at: string | null;
  submitted_at: string | null;
  minutes_to_answer: number | null;
  counts: { total: number; answered: number };
  can_edit: boolean;
  can_answer: boolean;
  is_reviewer: boolean;
  questions: InterviewQuestion[];
  existing?: boolean;
  created?: number;
  emailed?: { status: string; detail: string } | null;
};

export type InterviewSummary = {
  id: string;
  status: InterviewView["status"];
  on_behalf: boolean;
  respondent: string;
  total: number;
  answered: number;
  sent_at: string | null;
  submitted_at: string | null;
};
