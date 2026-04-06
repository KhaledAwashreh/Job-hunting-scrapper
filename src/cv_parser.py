"""
CV Parser Module - Extracts text and structured info from PDF resumes
"""
import re
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF


class CVData:
    """Structured CV data"""
    def __init__(self, raw_text: str, file_path: str):
        self.raw_text = raw_text
        self.file_path = file_path
        self.name: Optional[str] = None
        self.email: Optional[str] = None
        self.phone: Optional[str] = None
        self.skills: list[str] = []
        self.experience: list[str] = []
        self.education: list[str] = []
        
        self._extract_contact_info()
        self._extract_skills()
    
    def _extract_contact_info(self):
        """Extract email and phone from text"""
        # Email pattern
        email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', self.raw_text)
        if email_match:
            self.email = email_match.group()
        
        # Phone patterns (various formats)
        phone_patterns = [
            r'\+?[\d\s\-\(\)]{10,}',
            r'\d{3}[-.\s]?\d{3}[-.\s]?\d{4}',
        ]
        for pattern in phone_patterns:
            phone_match = re.search(pattern, self.raw_text)
            if phone_match:
                self.phone = phone_match.group().strip()
                break
        
        # Try to extract name (usually first line or near email)
        lines = [l.strip() for l in self.raw_text.split('\n') if l.strip()]
        if lines:
            # First line often contains the name
            first_line = lines[0]
            if len(first_line) < 50 and '@' not in first_line and not first_line.startswith('+'):
                self.name = first_line
    
    def _extract_skills(self):
        """Extract potential skills from CV text"""
        # Common tech skills patterns
        skill_patterns = [
            r'\b(Python|Java|JavaScript|TypeScript|C\+\+|Go|Rust|Ruby|PHP|Swift|Kotlin)\b',
            r'\b(React|Angular|Vue|Node\.js|Express|Django|Flask|Spring)\b',
            r'\b(AWS|Azure|GCP|Docker|Kubernetes|Jenkins|CI/CD)\b',
            r'\b(SQL|MySQL|PostgreSQL|MongoDB|Redis|Elasticsearch)\b',
            r'\b(Git|Linux|Agile|Scrum|TDD|API|REST|GraphQL)\b',
            r'\b(Machine Learning|Deep Learning|TensorFlow|PyTorch|NLP|Computer Vision)\b',
            r'\b(Excel|Power BI|Tableau|Spark|Hadoop|Kafka)\b',
        ]
        
        found_skills = set()
        for pattern in skill_patterns:
            matches = re.findall(pattern, self.raw_text, re.IGNORECASE)
            found_skills.update(m.title() for m in matches)
        
        self.skills = sorted(list(found_skills))
    
    def __str__(self):
        return f"CVData(name={self.name}, email={self.email}, skills={len(self.skills)})"


def parse_cv(file_path: str) -> CVData:
    """
    Parse a CV/resume PDF and extract structured information.
    
    Args:
        file_path: Path to the PDF file
        
    Returns:
        CVData object with extracted information
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"CV file not found: {file_path}")
    
    if path.suffix.lower() != '.pdf':
        raise ValueError("Only PDF files are supported")
    
    # Extract text from PDF
    text_parts = []
    with fitz.open(file_path) as doc:
        for page in doc:
            text_parts.append(page.get_text())
    
    raw_text = '\n'.join(text_parts)
    return CVData(raw_text=raw_text, file_path=str(path))


if __name__ == "__main__":
    # Test
    print("CV Parser module loaded")
