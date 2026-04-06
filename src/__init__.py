"""
RefNet - AI-Powered Job Scraper with CV Matching

Scrape jobs from multiple sites and match against your CV using AI.
"""
from .cv_parser import parse_cv, CVData
from .scraper import JobScraperManager, JobListing
from .matcher import OllamaMatcher, MatchResult

__all__ = [
    "parse_cv",
    "CVData",
    "JobScraperManager", 
    "JobListing",
    "JobData",
    "OllamaMatcher",
    "MatchResult",
]
