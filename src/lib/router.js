import { useEffect, useState } from 'react';

/**
 * Minimal hash router (GitHub Pages compatible — no server routes, mission §5.1/§9.2).
 *
 * Routes:
 *   #/                      browse experiences (original view)
 *   #/professors            professor directory
 *   #/professor/<key>       professor profile (key = normalized name, URL-encoded)
 *   #/courses               course directory
 *   #/course/<key>          course profile
 *   #/explore               full-text & topic explorer
 *   #/experience/<id>       deep link — opens the details dialog over the browse view
 */

export const ROUTES = {
  browse: '#/',
  professors: '#/professors',
  courses: '#/courses',
  explore: '#/explore',
};

export function professorRoute(key) {
  return `#/professor/${encodeURIComponent(key)}`;
}

export function courseRoute(key) {
  return `#/course/${encodeURIComponent(key)}`;
}

export function experienceRoute(identity) {
  return `#/experience/${encodeURIComponent(identity)}`;
}

export function coursesListSearchLink(courseName) {
  // Verified contract (Phase II §3): CoursesList reads `?q=` on load.
  return `https://iaucourseexp.github.io/CoursesList/?q=${encodeURIComponent(courseName)}`;
}

export function parseRoute(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (!h || h === '/') return { name: 'browse' };
  const parts = h.split('/').filter(Boolean);
  switch (parts[0]) {
    case 'professors':
      return { name: 'professors' };
    case 'courses':
      return { name: 'courses' };
    case 'explore':
      return { name: 'explore' };
    case 'professor':
      return parts[1]
        ? { name: 'professor', key: decodeURIComponent(parts[1]) }
        : { name: 'professors' };
    case 'course':
      return parts[1]
        ? { name: 'course', key: decodeURIComponent(parts[1]) }
        : { name: 'courses' };
    case 'experience': {
      // Identity may be a numeric source id or a synthetic app-only id
      // (x-…-o…) for records without a safe source id (Phase IV §7.3).
      const id = parts[1] ? decodeURIComponent(parts[1]) : null;
      return id ? { name: 'experience', id } : { name: 'browse' };
    }
    default:
      return { name: 'browse' };
  }
}

/** Subscribe to hash changes. */
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    function onChange() {
      setRoute(parseRoute(window.location.hash));
    }
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
