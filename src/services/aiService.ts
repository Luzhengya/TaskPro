import { GoogleGenAI } from "@google/genai";
import { SubTask } from "../types";

const MODEL = "gemini-3-flash-preview";

/** 汎用 prompt 実行。AI 呼び出しは全部ここに集約。プロンプトは呼出側で組む。 */
async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is not configured.");
  }
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
  });
  return response.text || "";
}

export const aiService = {
  /** 汎用呼出：任意の prompt を投げて文字列を取得。 */
  async generate(prompt: string): Promise<string> {
    try {
      return await callGemini(prompt);
    } catch (error) {
      console.error("AI Generation Error:", error);
      throw error;
    }
  },

  /** 既存：今日/未完/遅延の 3 区分でサマリー生成（簡易版）。 */
  async generateSummary(tasks: { today: SubTask[]; unfinished: SubTask[]; delayed: SubTask[] }) {
    const prompt = `
      As a task management assistant, analyze the following tasks and provide a concise summary in Japanese.

      Today's Tasks:
      ${tasks.today.map(t => `- ${t.task_name} (${t.status})`).join('\n')}

      Unfinished Tasks:
      ${tasks.unfinished.map(t => `- ${t.task_name} (${t.status})`).join('\n')}

      Delayed Tasks:
      ${tasks.delayed.map(t => `- ${t.task_name} (${t.status}, Deadline: ${t.final_deadline})`).join('\n')}

      The summary should include:
      1. Overview of delayed tasks and their impact.
      2. Potential risks (e.g., tasks nearing deadline).
      3. Summary of today's progress.
      4. Recommendations for tomorrow.
    `;
    return aiService.generate(prompt).then(text => text || "AI summary generation failed.");
  },
};
