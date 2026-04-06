"""
AI Matching Module - Uses Ollama LLM to match CVs with job listings
"""
import os
from dataclasses import dataclass
from typing import Optional

import httpx
from dotenv import load_dotenv

from .cv_parser import CVData
from .scraper import JobListing


load_dotenv()


@dataclass
class MatchResult:
    """Result of matching a CV against a job"""
    job: JobListing
    score: float  # 0-100
    reasoning: str
    matched_skills: list[str] = None
    missing_skills: list[str] = None
    
    def __post_init__(self):
        if self.matched_skills is None:
            self.matched_skills = []
        if self.missing_skills is None:
            self.missing_skills = []


class OllamaMatcher:
    """Matches CVs against job listings using Ollama LLM"""
    
    def __init__(
        self,
        base_url: str = "http://localhost:11434/v1",
        model: str = "devstral",
        api_key: Optional[str] = None
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key or os.getenv("OLLAMA_API_KEY")
        
        # Build headers with API key if provided
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        self.client = httpx.Client(timeout=120.0, headers=headers)
    
    def _build_prompt(self, cv: CVData, job: JobListing) -> str:
        """Build the matching prompt"""
        return f"""You are an expert HR recruiter. Evaluate how well a candidate's CV matches a job posting.

## CANDIDATE CV
Name: {cv.name or "Not specified"}
Email: {cv.email or "Not specified"}
Skills: {", ".join(cv.skills) if cv.skills else "Not specified"}

CV Summary (first 2000 chars):
{cv.raw_text[:2000]}

## JOB POSTING
Title: {job.title}
Company: {job.company}
Location: {job.location}
Salary: {job.salary or "Not specified"}
Description: {job.description or "No description available"}

## TASK
Analyze the match between this CV and job posting. Return a JSON response with:
- "score": integer 0-100 (how well they match)
- "reasoning": brief explanation (2-3 sentences)
- "matched_skills": list of skills from CV that match job requirements
- "missing_skills": list of important skills the CV is missing

Be honest and critical. A good CV should score 70-90. A perfect match 95+. Poor matches below 50.

Return ONLY valid JSON, no markdown or additional text."""
    
    def match(self, cv: CVData, job: JobListing) -> MatchResult:
        """
        Match a CV against a single job listing.
        
        Args:
            cv: Parsed CV data
            job: Job listing to match against
            
        Returns:
            MatchResult with score and reasoning
        """
        prompt = self._build_prompt(cv, job)
        
        try:
            response = self.client.post(
                f"{self.base_url}/chat/completions",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": "You are a helpful HR assistant."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 500
                }
            )
            
            if response.status_code != 200:
                return MatchResult(
                    job=job,
                    score=0.0,
                    reasoning=f"API error: {response.status_code}"
                )
            
            result = response.json()
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "{}")
            
            # Parse JSON response
            import json
            try:
                # Try to extract JSON from the response
                json_start = content.find("{")
                json_end = content.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    data = json.loads(content[json_start:json_end])
                else:
                    data = json.loads(content)
                
                return MatchResult(
                    job=job,
                    score=float(data.get("score", 0)),
                    reasoning=data.get("reasoning", "No reasoning provided"),
                    matched_skills=data.get("matched_skills", []),
                    missing_skills=data.get("missing_skills", [])
                )
            except json.JSONDecodeError:
                return MatchResult(
                    job=job,
                    score=0.0,
                    reasoning="Failed to parse LLM response"
                )
                
        except Exception as e:
            return MatchResult(
                job=job,
                score=0.0,
                reasoning=f"Error: {str(e)}"
            )
    
    def match_batch(
        self, 
        cv: CVData, 
        jobs: list[JobListing],
        show_progress: bool = True
    ) -> list[MatchResult]:
        """
        Match a CV against multiple jobs.
        
        Args:
            cv: Parsed CV data
            jobs: List of job listings
            show_progress: Show progress bar
            
        Returns:
            List of MatchResults sorted by score (descending)
        """
        results = []
        
        if show_progress:
            from tqdm import tqdm
            iterator = tqdm(jobs, desc="Matching jobs")
        else:
            iterator = jobs
        
        for job in iterator:
            result = self.match(cv, job)
            results.append(result)
        
        # Sort by score descending
        results.sort(key=lambda x: x.score, reverse=True)
        return results
    
    def close(self):
        """Close the HTTP client"""
        self.client.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        self.close()


def get_matcher() -> OllamaMatcher:
    """Factory function to create matcher with config from env"""
    return OllamaMatcher(
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
        model=os.getenv("OLLAMA_MODEL", "devstral")
    )


if __name__ == "__main__":
    print("AI Matcher module loaded")
