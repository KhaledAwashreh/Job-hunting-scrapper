"""
Job Scraper Module - Scrapes jobs from multiple job sites
Uses a site repository (job_sites.json) for easy extensibility
"""
import asyncio
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import quote, urlencode

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright


@dataclass
class JobListing:
    """Standardized job listing data"""
    title: str
    company: str
    location: str
    description: str
    url: str
    source: str  # Site ID from job_sites.json
    salary: Optional[str] = None
    posted_date: Optional[str] = None
    job_type: Optional[str] = None  # full-time, part-time, contract


@dataclass 
class SiteConfig:
    """Configuration for a job site"""
    id: str
    name: str
    base_url: str
    search_url: Optional[str] = None
    search_params: dict = field(default_factory=dict)
    selectors: dict = field(default_factory=dict)
    requires_browser: bool = False
    rate_limit_ms: int = 1000
    country_filter: Optional[str] = None


class SiteRepository:
    """Loads and manages job site configurations"""
    
    def __init__(self, config_path: str = None):
        if config_path is None:
            config_path = Path(__file__).parent.parent / "job_sites.json"
        self.config_path = Path(config_path)
        self._load_config()
    
    def _load_config(self):
        """Load site configurations from JSON file"""
        with open(self.config_path) as f:
            self.data = json.load(f)
        
        # Build lookup maps
        self.global_sites = {
            s["id"]: SiteConfig(**s) 
            for s in self.data.get("global", {}).get("sites", [])
        }
        
        self.country_sites = {}
        for country_code, country_data in self.data.get("countries", {}).items():
            self.country_sites[country_code] = {
                s["id"]: SiteConfig(**s) 
                for s in country_data.get("sites", [])
            }
    
    def get_sites_for_countries(self, countries: list[str]) -> list[SiteConfig]:
        """Get all sites for given country names"""
        sites = []
        seen_ids = set()
        
        # Normalize country names to lowercase codes
        country_map = {
            "ireland": "ireland", "irish": "ireland",
            "netherlands": "netherlands", "dutch": "netherlands", "holland": "netherlands",
            "spain": "spain", "spanish": "spain",
            "germany": "germany", "german": "germany",
            "france": "france", "french": "france",
            "uk": "uk", "united kingdom": "uk", "britain": "uk", "england": "uk",
            "austria": "austria", "austrian": "austria",
            "switzerland": "switzerland", "swiss": "switzerland",
            "belgium": "belgium", "belgian": "belgium",
            "sweden": "sweden", "swedish": "sweden",
        }
        
        for country in countries:
            country_lower = country.lower().strip()
            country_code = country_map.get(country_lower, country_lower)
            
            # Get country-specific sites
            if country_code in self.country_sites:
                for site_id, site in self.country_sites[country_code].items():
                    if site_id not in seen_ids:
                        sites.append(site)
                        seen_ids.add(site_id)
            
            # Also add global sites (avoiding duplicates)
            for site_id, site in self.global_sites.items():
                if site_id not in seen_ids:
                    sites.append(site)
                    seen_ids.add(site_id)
        
        return sites
    
    def get_site_by_id(self, site_id: str) -> Optional[SiteConfig]:
        """Get a specific site by ID"""
        if site_id in self.global_sites:
            return self.global_sites[site_id]
        for country_sites in self.country_sites.values():
            if site_id in country_sites:
                return country_sites[site_id]
        return None
    
    def add_site(self, country: str, site: SiteConfig):
        """Add a new site to the repository"""
        country_code = country.lower()
        if country_code not in self.country_sites:
            self.country_sites[country_code] = {}
        self.country_sites[country_code][site.id] = site
    
    def save(self):
        """Save current config back to file"""
        # Rebuild data structure
        self.data["countries"] = {
            code: {"name": code.capitalize(), "sites": [
                {"id": s.id, "name": s.name, "base_url": s.base_url}
                for s in sites.values()
            ]}
            for code, sites in self.country_sites.items()
        }
        with open(self.config_path, 'w') as f:
            json.dump(self.data, f, indent=2)


class BaseScraper(ABC):
    """Base class for job scrapers"""
    
    def __init__(self, config: SiteConfig):
        self.config = config
        self.jobs: list[JobListing] = []
    
    @abstractmethod
    async def scrape(self, keywords: str, location: str, limit: int = 50) -> list[JobListing]:
        """Scrape jobs matching criteria"""
        pass
    
    async def _rate_limit(self):
        """Apply rate limiting between requests"""
        await asyncio.sleep(self.config.rate_limit_ms / 1000)


class HTTPScraper(BaseScraper):
    """Scraper using httpx for sites that don't need a browser"""
    
    async def scrape(self, keywords: str, location: str, limit: int = 50) -> list[JobListing]:
        """Scrape using HTTP requests"""
        jobs = []
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            offset = 0
            page_size = 15
            
            while len(jobs) < limit:
                await self._rate_limit()
                
                # Build URL based on config
                if self.config.search_params:
                    params = {
                        "keywords": keywords,
                        "location": location,
                        "offset": str(offset)
                    }
                    # Map to actual param names
                    params = {
                        self.config.search_params.get(k, k): v 
                        for k, v in params.items()
                    }
                    url = self.config.base_url + "?" + urlencode(params)
                else:
                    search_url = self.config.search_url.format(
                        keywords=quote(keywords),
                        location=quote(location)
                    )
                    url = search_url
                
                try:
                    response = await client.get(url)
                    if response.status_code != 200:
                        break
                    
                    soup = BeautifulSoup(response.text, "lxml")
                    new_jobs = self._parse_jobs(soup)
                    
                    if not new_jobs:
                        break
                    
                    jobs.extend(new_jobs)
                    offset += page_size
                    
                except Exception as e:
                    print(f"Error scraping {self.config.name}: {e}")
                    break
        
        self.jobs = jobs[:limit]
        return self.jobs
    
    def _parse_jobs(self, soup: BeautifulSoup) -> list[JobListing]:
        """Parse job listings from HTML"""
        jobs = []
        selectors = self.config.selectors
        
        job_cards = soup.select(selectors.get("job_card", ".job"))
        
        for card in job_cards:
            try:
                title_elem = card.select_one(selectors.get("title", "h2"))
                company_elem = card.select_one(selectors.get("company", ".company"))
                location_elem = card.select_one(selectors.get("location", ".location"))
                salary_elem = card.select_one(selectors.get("salary", ".salary"))
                
                url_elem = card.select_one(selectors.get("url", "a"))
                url_attr = selectors.get("url_attr", "href")
                url = url_elem.get(url_attr, "") if url_elem else ""
                
                if title_elem:
                    job = JobListing(
                        title=title_elem.get_text(strip=True),
                        company=company_elem.get_text(strip=True) if company_elem else "Unknown",
                        location=location_elem.get_text(strip=True) if location_elem else "",
                        description="",
                        url=url if url.startswith("http") else self.config.base_url + url,
                        source=self.config.id,
                        salary=salary_elem.get_text(strip=True) if salary_elem else None
                    )
                    jobs.append(job)
            except Exception:
                continue
        
        return jobs


class BrowserScraper(BaseScraper):
    """Scraper using Playwright for JavaScript-rendered sites"""
    
    async def scrape(self, keywords: str, location: str, limit: int = 50) -> list[JobListing]:
        """Scrape using browser automation"""
        jobs = []
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            )
            page = await context.new_page()
            
            # Build URL
            if self.config.search_url:
                url = self.config.search_url.format(
                    keywords=quote(keywords),
                    location=quote(location)
                )
            else:
                params = {k: v for k, v in [
                    ("keywords", keywords),
                    ("location", location)
                ]}
                params = {
                    self.config.search_params.get(k, k): v 
                    for k, v in params.items()
                }
                url = self.config.base_url + "?" + urlencode(params)
            
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(2)  # Wait for dynamic content
                
                # Scroll to load more
                for _ in range(3):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await asyncio.sleep(1)
                
                content = await page.content()
                soup = BeautifulSoup(content, "lxml")
                
                jobs = self._parse_jobs(soup, limit)
                
            except Exception as e:
                print(f"Error scraping {self.config.name}: {e}")
            finally:
                await browser.close()
        
        self.jobs = jobs[:limit]
        return self.jobs
    
    def _parse_jobs(self, soup: BeautifulSoup, limit: int) -> list[JobListing]:
        """Parse job listings from HTML"""
        jobs = []
        selectors = self.config.selectors
        
        job_cards = soup.select(selectors.get("job_card", ".job"))[:limit]
        
        for card in job_cards:
            try:
                title_elem = card.select_one(selectors.get("title", "h2"))
                company_elem = card.select_one(selectors.get("company", ".company"))
                location_elem = card.select_one(selectors.get("location", ".location"))
                
                url_elem = card.select_one(selectors.get("url", "a"))
                url_attr = selectors.get("url_attr", "href")
                url = url_elem.get(url_attr, "") if url_elem else ""
                
                if title_elem:
                    job = JobListing(
                        title=title_elem.get_text(strip=True),
                        company=company_elem.get_text(strip=True) if company_elem else "Unknown",
                        location=location_elem.get_text(strip=True) if location_elem else "",
                        description="",
                        url=url if url.startswith("http") else self.config.base_url + url,
                        source=self.config.id
                    )
                    jobs.append(job)
            except Exception:
                continue
        
        return jobs


class LinkedInScraper(BaseScraper):
    """LinkedIn job scraper - special case with their API"""
    
    BASE_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
    
    async def scrape(self, keywords: str, location: str, limit: int = 50) -> list[JobListing]:
        """Scrape jobs from LinkedIn"""
        jobs = []
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            
            params = {"keywords": keywords, "location": location, "start": 0}
            
            for offset in range(0, min(limit, 1000), 25):
                await self._rate_limit()
                params["start"] = offset
                
                try:
                    response = await page.request.get(self.BASE_URL, params=params)
                    if response.status != 200:
                        break
                    
                    soup = BeautifulSoup(await response.text(), "lxml")
                    job_cards = soup.select(".job-search-card")
                    
                    if not job_cards:
                        break
                    
                    for card in job_cards:
                        if len(jobs) >= limit:
                            break
                        
                        try:
                            title = card.select_one(".job-search-card__title")
                            company = card.select_one(".job-search-card__subtitle")
                            
                            if title:
                                job = JobListing(
                                    title=title.get_text(strip=True),
                                    company=company.get_text(strip=True) if company else "Unknown",
                                    location=location,
                                    description="",
                                    url=card.get("data-job-url", ""),
                                    source="linkedin"
                                )
                                jobs.append(job)
                        except Exception:
                            continue
                    
                except Exception as e:
                    print(f"LinkedIn scrape error: {e}")
                    break
            
            await browser.close()
        
        self.jobs = jobs
        return jobs


class JobScraperManager:
    """Manages job scraping across multiple sites"""
    
    def __init__(self, site_repository: SiteRepository = None):
        self.repository = site_repository or SiteRepository()
        
        # Custom scrapers for special sites
        self.custom_scrapers = {
            "linkedin": LinkedInScraper,
        }
    
    def _create_scraper(self, config: SiteConfig) -> BaseScraper:
        """Create appropriate scraper for a site"""
        # Check for custom scraper first
        if config.id in self.custom_scrapers:
            return self.custom_scrapers[config.id](config)
        
        # Choose based on browser requirement
        if config.requires_browser:
            return BrowserScraper(config)
        else:
            return HTTPScraper(config)
    
    async def scrape_all(
        self, 
        keywords: str, 
        locations: list[str], 
        sites: Optional[list[str]] = None,
        limit_per_site: int = 50
    ) -> list[JobListing]:
        """
        Scrape jobs from multiple sites and locations.
        
        Args:
            keywords: Job search keywords
            locations: List of locations/countries
            sites: Optional list of specific site IDs to scrape
            limit_per_site: Max jobs per site per location
        """
        all_jobs = []
        
        # Get sites to scrape
        if sites:
            # Use specified sites
            site_configs = []
            for site_id in sites:
                config = self.repository.get_site_by_id(site_id)
                if config:
                    site_configs.append(config)
        else:
            # Use all sites for given countries
            site_configs = self.repository.get_sites_for_countries(locations)
        
        # Create scrapers
        scrapers = []
        for config in site_configs:
            scraper = self._create_scraper(config)
            scrapers.append((scraper, config.name))
        
        # Run scrapers
        tasks = [
            scraper.scrape(keywords, loc, limit_per_site)
            for scraper, name in scrapers
            for loc in locations
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, list):
                all_jobs.extend(result)
        
        return all_jobs
    
    def list_available_sites(self) -> list[tuple[str, str]]:
        """List all available sites (id, name)"""
        sites = []
        
        for site_id, site in self.repository.global_sites.items():
            sites.append((site_id, f"{site.name} (Global)"))
        
        for country_code, country_sites in self.repository.country_sites.items():
            country_name = country_code.capitalize()
            for site_id, site in country_sites.items():
                sites.append((site_id, f"{site.name} ({country_name})"))
        
        return sites


if __name__ == "__main__":
    # Demo: list available sites
    repo = SiteRepository()
    print("Available sites:")
    for site_id, name in JobScraperManager(repo).list_available_sites():
        print(f"  {site_id}: {name}")
