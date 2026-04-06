#!/usr/bin/env python3
"""
RefNet - Job Scraper with CV Matching

Usage:
    python main.py --cv ./my_cv.pdf --countries Ireland Spain Netherlands
"""
import asyncio
import json
import os
from pathlib import Path

import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn

from src.cv_parser import parse_cv, CVData
from src.scraper import JobScraperManager, JobListing
from src.matcher import OllamaMatcher, MatchResult

load_dotenv()
app = typer.Typer(help="RefNet - AI-Powered Job Scraper with CV Matching")
console = Console()


def display_cv_info(cv: CVData):
    """Display parsed CV information"""
    console.print("\n[bold cyan]CV Information[/bold cyan]")
    console.print(f"  Name: {cv.name or 'N/A'}")
    console.print(f"  Email: {cv.email or 'N/A'}")
    console.print(f"  Phone: {cv.phone or 'N/A'}")
    console.print(f"  Skills found: {len(cv.skills)}")
    if cv.skills:
        console.print(f"  [dim]{', '.join(cv.skills[:10])}[/dim]")


def display_matches(results: list[MatchResult], limit: int = 20):
    """Display matching results in a table"""
    console.print(f"\n[bold green]Top {limit} Job Matches[/bold green]")
    
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("#", style="dim", width=3)
    table.add_column("Score", width=6, justify="right")
    table.add_column("Title", width=30)
    table.add_column("Company", width=20)
    table.add_column("Location", width=20)
    table.add_column("Source", width=10)
    
    for i, result in enumerate(results[:limit], 1):
        job = result.job
        score_color = (
            "[green]" if result.score >= 70
            else "[yellow]" if result.score >= 50
            else "[red]"
        )
        table.add_row(
            str(i),
            f"{score_color}{result.score:.0f}[/]",
            job.title[:30],
            job.company[:20],
            job.location[:20],
            job.source
        )
    
    console.print(table)
    
    # Show top 3 detailed results
    console.print("\n[bold]Detailed Analysis (Top 3):[/bold]")
    for i, result in enumerate(results[:3], 1):
        job = result.job
        console.print(f"\n[cyan]{i}. {job.title} @ {job.company}[/cyan]")
        console.print(f"   [dim]Location:[/dim] {job.location}")
        console.print(f"   [dim]Match Score:[/dim] {result.score:.0f}/100")
        console.print(f"   [dim]Reasoning:[/dim] {result.reasoning}")
        if result.matched_skills:
            console.print(f"   [dim]Matched:[/dim] {', '.join(result.matched_skills[:5])}")
        if result.missing_skills:
            console.print(f"   [dim]Missing:[/dim] {', '.join(result.missing_skills[:5])}")


async def scrape_jobs(countries: list[str], keywords: str, sites: list[str], limit: int) -> list[JobListing]:
    """Scrape jobs from configured sources"""
    console.print(f"\n[yellow]Scraping jobs for:[/yellow] {', '.join(countries)}")
    console.print(f"[yellow]Sites:[/yellow] {', '.join(sites)}")
    
    manager = JobScraperManager()
    jobs = await manager.scrape_all(
        keywords=keywords,
        locations=countries,
        sites=sites,
        limit_per_site=limit
    )
    
    console.print(f"[green]Found {len(jobs)} jobs[/green]")
    return jobs


@app.command()
def main(
    cv: Path = typer.Option(..., "--cv", help="Path to your CV PDF file"),
    countries: list[str] = typer.Option(..., "--countries", help="Countries to search (e.g., Ireland Spain Netherlands)"),
    keywords: str = typer.Option("software engineer", "--keywords", "-k", help="Job search keywords"),
    sites: list[str] = typer.Option(["linkedin", "indeed"], "--sites", help="Sites to scrape (linkedin, indeed, glassdoor)"),
    limit: int = typer.Option(30, "--limit", "-l", help="Jobs per site per country"),
    output: Path = typer.Option(None, "--output", "-o", help="Save results to JSON file"),
    skip_match: bool = typer.Option(False, "--skip-match", help="Only scrape, don't run AI matching"),
    min_score: int = typer.Option(0, "--min-score", help="Minimum match score to show"),
    ollama_model: str = typer.Option("devstral", "--ollama-model", help="Ollama model to use"),
    ollama_url: str = typer.Option("http://localhost:11434/v1", "--ollama-url", help="Ollama API URL"),
    ollama_api_key: str = typer.Option(None, "--ollama-api-key", help="Ollama API key (optional)"),
):
    """
    RefNet - Job Scraper with CV Matching
    
    Example:
        python main.py --cv ./my_cv.pdf --countries Ireland Spain Netherlands
    """
    # Validate CV file
    if not cv.exists():
        console.print(f"[red]Error: CV file not found: {cv}[/red]")
        raise typer.Exit(1)
    
    if cv.suffix.lower() != '.pdf':
        console.print("[red]Error: CV must be a PDF file[/red]")
        raise typer.Exit(1)
    
    # Parse CV
    console.print(f"\n[cyan]Parsing CV:[/cyan] {cv}")
    try:
        cv_data = parse_cv(str(cv))
        display_cv_info(cv_data)
    except Exception as e:
        console.print(f"[red]Error parsing CV: {e}[/red]")
        raise typer.Exit(1)
    
    # Scrape jobs
    jobs = asyncio.run(scrape_jobs(countries, keywords, sites, limit))
    
    if not jobs:
        console.print("[yellow]No jobs found. Try different keywords or countries.[/yellow]")
        raise typer.Exit(0)
    
    # Match with CV if not skipped
    if not skip_match:
        console.print("\n[cyan]Starting AI matching...[/cyan]")
        console.print(f"[dim]Using Ollama model: {ollama_model}[/dim]")
        
        try:
            matcher = OllamaMatcher(
                base_url=ollama_url,
                model=ollama_model,
                api_key=ollama_api_key
            )
            
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                progress.add_task("Matching jobs...", total=None)
                results = matcher.match_batch(cv_data, jobs, show_progress=True)
            
            matcher.close()
            
            # Filter by minimum score
            if min_score > 0:
                results = [r for r in results if r.score >= min_score]
                console.print(f"[green]Filtered to {len(results)} jobs with score >= {min_score}[/green]")
            
            # Display results
            display_matches(results)
            
            # Save to file if requested
            if output:
                output_data = [
                    {
                        "score": r.score,
                        "title": r.job.title,
                        "company": r.job.company,
                        "location": r.job.location,
                        "url": r.job.url,
                        "source": r.job.source,
                        "reasoning": r.reasoning,
                        "matched_skills": r.matched_skills or [],
                        "missing_skills": r.missing_skills or []
                    }
                    for r in results
                ]
                with open(output, 'w') as f:
                    json.dump(output_data, f, indent=2)
                console.print(f"\n[green]Results saved to:[/green] {output}")
                
        except Exception as e:
            console.print(f"[red]Error during matching: {e}[/red]")
            console.print("[dim]Make sure Ollama is running with 'ollama serve'[/dim]")
    else:
        # Just save raw jobs
        console.print(f"\n[yellow]Skipping AI matching (--skip-match)[/yellow]")
        if output:
            output_data = [
                {
                    "title": j.title,
                    "company": j.company,
                    "location": j.location,
                    "url": j.url,
                    "source": j.source,
                    "salary": j.salary
                }
                for j in jobs
            ]
            with open(output, 'w') as f:
                json.dump(output_data, f, indent=2)
            console.print(f"\n[green]Jobs saved to:[/green] {output}")


if __name__ == "__main__":
    app()
