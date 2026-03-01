import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import get_github_token
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.github import GitHubRepo, GitHubReposResponse

router = APIRouter()
logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


@router.get("/repositories", response_model=GitHubReposResponse)
async def list_repositories(
    q: str = Query(default="", max_length=256),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    _current_user: User = Depends(get_current_user),
    github_token: str | None = Depends(get_github_token),
) -> GitHubReposResponse:
    if not github_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GitHub personal access token not configured",
        )

    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        if q.strip():
            response = await client.get(
                f"{GITHUB_API_BASE}/search/repositories",
                params={
                    "q": q.strip(),
                    "sort": "updated",
                    "order": "desc",
                    "per_page": per_page,
                    "page": page,
                },
                headers=headers,
            )
        else:
            response = await client.get(
                f"{GITHUB_API_BASE}/user/repos",
                params={
                    "sort": "pushed",
                    "direction": "desc",
                    "per_page": per_page,
                    "page": page,
                    "affiliation": "owner,collaborator,organization_member",
                },
                headers=headers,
            )

    if response.status_code == 401:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="GitHub token is invalid or expired",
        )
    if response.status_code != 200:
        logger.warning(
            "GitHub API returned %d: %s", response.status_code, response.text[:200]
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="GitHub API request failed",
        )

    data = response.json()
    raw_repos = data.get("items", data) if isinstance(data, dict) else data

    repos = [
        GitHubRepo(
            name=r["name"],
            full_name=r["full_name"],
            description=r.get("description"),
            language=r.get("language"),
            html_url=r["html_url"],
            clone_url=r["clone_url"],
            private=r.get("private", False),
            pushed_at=r.get("pushed_at"),
            stargazers_count=r.get("stargazers_count", 0),
        )
        for r in raw_repos
    ]

    return GitHubReposResponse(items=repos, has_more=len(raw_repos) == per_page)
