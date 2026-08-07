//! Fractional indexing for sibling ordering. A node's `position` is a short
//! base-62 string; the order of a parent's children is the plain lexicographic
//! order of these strings. To move a row you only rewrite *that* row's key to one
//! that sorts between its new neighbours — no renumbering of the rest (the whole
//! point, vs. integer positions). Keys grow by a character only when you keep
//! inserting into the same gap, so they stay short in practice.
//!
//! `key_between(lo, hi)` returns a key strictly between `lo` and `hi` under byte
//! order, where `None` means "unbounded" (before-everything for `lo`,
//! after-everything for `hi`). Callers must pass `lo < hi`. Adapted from the
//! well-known `fractional-indexing` midpoint algorithm.

const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// Index of a base-62 digit byte within `DIGITS`.
fn digit_val(c: u8) -> i32 {
    match c {
        b'0'..=b'9' => (c - b'0') as i32,
        b'A'..=b'Z' => (c - b'A') as i32 + 10,
        b'a'..=b'z' => (c - b'a') as i32 + 36,
        _ => 0,
    }
}

/// A key strictly between `lo` and `hi`. `None` bounds are open-ended.
/// Requires `lo < hi` when both are present (siblings read in sorted order).
pub fn key_between(lo: Option<&str>, hi: Option<&str>) -> String {
    // `""` is the smallest possible key, so it stands in for an open lower bound.
    midpoint(lo.unwrap_or(""), hi)
}

/// A key strictly between `a` (possibly `""`) and `b` (`None` = +infinity), by
/// construction never ending in the zero digit. Assumes `a < b`.
fn midpoint(a: &str, b: Option<&str>) -> String {
    if let Some(b) = b {
        // Copy the common prefix, padding a missing `a` digit with '0', then
        // recurse on the remainder so the difference is found digit-by-digit.
        let (ab, bb) = (a.as_bytes(), b.as_bytes());
        let mut n = 0;
        while n < bb.len() {
            let ca = if n < ab.len() { ab[n] } else { b'0' };
            if ca == bb[n] {
                n += 1;
            } else {
                break;
            }
        }
        if n > 0 {
            let a_rest = if n < a.len() { &a[n..] } else { "" };
            return format!("{}{}", &b[..n], midpoint(a_rest, Some(&b[n..])));
        }
    }

    let digit_a = if a.is_empty() { 0 } else { digit_val(a.as_bytes()[0]) };
    let digit_b = match b {
        Some(b) if !b.is_empty() => digit_val(b.as_bytes()[0]),
        Some(_) => 0,
        None => DIGITS.len() as i32,
    };

    if digit_b - digit_a > 1 {
        // Room for a single digit strictly between the two first digits.
        let mid = (((digit_a + digit_b) as f64) * 0.5).round() as usize;
        (DIGITS[mid] as char).to_string()
    } else if let Some(b) = b.filter(|b| b.len() > 1) {
        // First digits are adjacent but `b` has more digits — drop into b's tail.
        b[..1].to_string()
    } else {
        // Adjacent (or unbounded above): keep a's first digit and go deeper.
        let a_rest = if a.len() > 1 { &a[1..] } else { "" };
        format!("{}{}", DIGITS[digit_a as usize] as char, midpoint(a_rest, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_key_is_stable_and_midrange() {
        let k = key_between(None, None);
        assert!(!k.is_empty());
        assert!(!k.ends_with('0'));
    }

    #[test]
    fn appended_keys_strictly_increase() {
        // Simulate repeatedly appending to the end (what next_position does).
        let mut prev: Option<String> = None;
        let mut all = Vec::new();
        for _ in 0..1000 {
            let k = key_between(prev.as_deref(), None);
            if let Some(p) = &prev {
                assert!(k.as_str() > p.as_str(), "{k} should sort after {p}");
            }
            assert!(!k.ends_with('0'));
            prev = Some(k.clone());
            all.push(k);
        }
        let mut sorted = all.clone();
        sorted.sort();
        assert_eq!(all, sorted, "append order must match lexicographic order");
    }

    #[test]
    fn prepended_keys_strictly_decrease() {
        let mut next: Option<String> = None;
        for _ in 0..1000 {
            let k = key_between(None, next.as_deref());
            if let Some(n) = &next {
                assert!(k.as_str() < n.as_str(), "{k} should sort before {n}");
            }
            assert!(!k.ends_with('0'));
            next = Some(k);
        }
    }

    #[test]
    fn between_is_strictly_between_and_repeatable() {
        // Hammer the same gap: each new key must land between lo and the last
        // inserted key, so the whole run stays sorted.
        let lo = key_between(None, None);
        let hi = key_between(Some(&lo), None);
        let mut upper = hi.clone();
        for _ in 0..1000 {
            let mid = key_between(Some(&lo), Some(&upper));
            assert!(
                lo.as_str() < mid.as_str() && mid.as_str() < upper.as_str(),
                "{lo} < {mid} < {upper} violated"
            );
            assert!(!mid.ends_with('0'));
            upper = mid;
        }
    }

    #[test]
    fn insert_into_middle_of_a_sequence() {
        let a = key_between(None, None);
        let b = key_between(Some(&a), None);
        let c = key_between(Some(&b), None);
        // Insert between a and b, and between b and c.
        let ab = key_between(Some(&a), Some(&b));
        let bc = key_between(Some(&b), Some(&c));
        let mut v = vec![a, ab, b, bc, c];
        let sorted = {
            let mut s = v.clone();
            s.sort();
            s
        };
        assert_eq!(v, sorted);
        v.dedup();
        assert_eq!(v.len(), 5, "all keys distinct");
    }
}
