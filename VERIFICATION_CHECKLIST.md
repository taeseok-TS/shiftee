# Employee Search Feature - Verification Checklist

## Quick Start Verification (5 minutes)

Use this checklist to quickly verify the implementation is working correctly.

### Step 1: Build Verification
```bash
cd apps/web
npm run build
```

**Expected Output:**
- ✅ "Compiled successfully"
- ✅ No TypeScript errors
- ✅ 41 routes generated
- ✅ ~7 seconds compile time

**Result:** ☐ Pass / ☐ Fail

---

### Step 2: Dev Server Verification
```bash
npm run dev
```

**Expected Output:**
- ✅ Server starts on localhost:3000
- ✅ "ready - started server on 0.0.0.0:3000"
- ✅ No connection errors

**Result:** ☐ Pass / ☐ Fail

---

### Step 3: Login & Navigation
1. Open http://localhost:3000/login
2. Login with admin/manager account
3. Navigate to http://localhost:3000/contracts

**Expected Output:**
- ✅ Login page loads
- ✅ Successful authentication
- ✅ Contracts page loads
- ✅ "계약서 작성" button visible

**Result:** ☐ Pass / ☐ Fail

---

### Step 4: Dialog Opening
1. Click "계약서 작성" button
2. Contract creation dialog opens

**Expected Output:**
- ✅ Dialog appears
- ✅ Search input is visible
- ✅ Employee list is empty/populated
- ✅ Blue selection box is NOT visible

**Result:** ☐ Pass / ☐ Fail

---

### Step 5: Search Functionality
1. In search input, type "김"
2. Watch the employee list filter in real-time

**Expected Output:**
- ✅ Input accepts text
- ✅ List filters as you type
- ✅ Only employees with "김" in name/branch/dept shown
- ✅ Filtering happens instantly (< 100ms)

**Result:** ☐ Pass / ☐ Fail

---

### Step 6: Employee Selection
1. Click one of the filtered employees
2. Check the blue selection box

**Expected Output:**
- ✅ Blue box appears with employee name
- ✅ Search input is now empty
- ✅ Employee remains highlighted in list
- ✅ Can submit form with this employee selected

**Result:** ☐ Pass / ☐ Fail

---

### Step 7: Dialog Cleanup
1. Close the dialog (click X or outside)
2. Reopen the dialog (click "계약서 작성")
3. Check the state

**Expected Output:**
- ✅ Search input is empty
- ✅ No employee is selected
- ✅ Blue selection box is NOT visible
- ✅ All employees are shown again
- ✅ Completely clean state

**Result:** ☐ Pass / ☐ Fail

---

## Detailed Feature Verification (15 minutes)

### Feature: Name Search
```
Objective: Verify search filters by employee name
```

**Test Cases:**

1. Search: "김"
   - Expected: All employees with "김" in name
   - Result: ☐ Pass / ☐ Fail

2. Search: "영희"
   - Expected: All employees with "영희" in name
   - Result: ☐ Pass / ☐ Fail

3. Search: "zzz" (non-existent)
   - Expected: "검색 결과 없음" message
   - Result: ☐ Pass / ☐ Fail

4. Search: "" (empty)
   - Expected: All employees shown again
   - Result: ☐ Pass / ☐ Fail

---

### Feature: Branch Search
```
Objective: Verify search filters by branch name
```

**Test Cases:**

1. Search: "서울"
   - Expected: Employees from 서울 branch only
   - Result: ☐ Pass / ☐ Fail

2. Search: "강남"
   - Expected: Employees from 강남 branch only
   - Result: ☐ Pass / ☐ Fail

3. Search: "부산"
   - Expected: Employees from 부산 branch (if exists)
   - Result: ☐ Pass / ☐ Fail

---

### Feature: Department Search
```
Objective: Verify search filters by department name
```

**Test Cases:**

1. Search: "개발"
   - Expected: Employees from development department
   - Result: ☐ Pass / ☐ Fail

2. Search: "영업"
   - Expected: Employees from sales department
   - Result: ☐ Pass / ☐ Fail

3. Search: "인사"
   - Expected: Employees from HR department
   - Result: ☐ Pass / ☐ Fail

---

### Feature: Case Insensitivity
```
Objective: Verify search is case-insensitive
```

**Test Cases:**

1. Search: "KIM"
   - Expected: Same results as "kim" or "김"
   - Result: ☐ Pass / ☐ Fail

2. Search: "SEOUL"
   - Expected: Same results as "seoul" or "서울"
   - Result: ☐ Pass / ☐ Fail

---

### Feature: Selection Persistence
```
Objective: Verify selected employee stays selected
```

**Test Cases:**

1. Select employee
2. Blue box appears
3. Clear search by deleting text
4. Employee still selected
   - Result: ☐ Pass / ☐ Fail

---

### Feature: Form Submission
```
Objective: Verify form submission with selected employee
```

**Test Cases:**

1. Select employee
2. Fill in other form fields:
   - Title: "테스트"
   - Type: "근로계약서"
   - File: Upload a file (or use template)
3. Click submit button
4. Verify contract is created with correct employee
   - Result: ☐ Pass / ☐ Fail

---

## Performance Verification (5 minutes)

### Response Time Test
```
Objective: Verify response times are acceptable
```

| Action | Expected | Actual | Status |
|--------|----------|--------|--------|
| Search filter | < 100ms | ____ | ☐ Pass |
| Component re-render | < 50ms | ____ | ☐ Pass |
| Dialog open | < 200ms | ____ | ☐ Pass |
| Dialog close | < 200ms | ____ | ☐ Pass |
| Form submission | < 1s | ____ | ☐ Pass |

---

### Browser Console Check
```
Objective: Verify no JavaScript errors in console
```

**Steps:**
1. Open browser developer tools (F12)
2. Go to Console tab
3. Clear console
4. Perform searches and selections
5. Check for errors

**Expected:**
- ✅ No red error messages
- ✅ No warnings about React/state
- ✅ No network 4xx/5xx errors

**Result:** ☐ Pass / ☐ Fail

---

## Browser Compatibility (10 minutes)

### Chrome
- ✅ Open dialog
- ✅ Search functionality
- ✅ Employee selection
- ✅ Form submission
- **Result:** ☐ Pass / ☐ Fail

### Firefox
- ✅ Open dialog
- ✅ Search functionality
- ✅ Employee selection
- ✅ Form submission
- **Result:** ☐ Pass / ☐ Fail

### Safari
- ✅ Open dialog
- ✅ Search functionality
- ✅ Employee selection
- ✅ Form submission
- **Result:** ☐ Pass / ☐ Fail

### Edge
- ✅ Open dialog
- ✅ Search functionality
- ✅ Employee selection
- ✅ Form submission
- **Result:** ☐ Pass / ☐ Fail

---

## Mobile Verification (10 minutes)

### iPhone/iPad
1. Open http://localhost:3000/contracts on mobile Safari
2. Login and navigate to contracts
3. Click "계약서 작성"
4. Test search and selection

**Expected:**
- ✅ Dialog is responsive
- ✅ Search input is readable
- ✅ Employee list scrolls properly
- ✅ Buttons are touch-friendly
- ✅ No text overflow

**Result:** ☐ Pass / ☐ Fail

### Android
1. Open http://localhost:3000/contracts on Android Chrome
2. Login and navigate to contracts
3. Click "계약서 작성"
4. Test search and selection

**Expected:**
- ✅ Dialog is responsive
- ✅ Search input is readable
- ✅ Employee list scrolls properly
- ✅ Buttons are touch-friendly
- ✅ No text overflow

**Result:** ☐ Pass / ☐ Fail

---

## Edge Cases (10 minutes)

### Edge Case 1: Rapid Searching
```
Objective: Verify rapid typing doesn't break the feature
```

**Steps:**
1. Rapidly type multiple characters
2. Delete characters rapidly
3. Type again

**Expected:**
- ✅ No crashes
- ✅ No lag
- ✅ Filtering remains accurate

**Result:** ☐ Pass / ☐ Fail

---

### Edge Case 2: Special Characters
```
Objective: Verify special characters don't break search
```

**Steps:**
1. Search with special characters: "!"
2. Search with numbers: "123"
3. Search with symbols: "@#$"

**Expected:**
- ✅ Search handles gracefully
- ✅ Shows "검색 결과 없음"
- ✅ No error messages

**Result:** ☐ Pass / ☐ Fail

---

### Edge Case 3: Very Long Names
```
Objective: Verify long names display properly
```

**Steps:**
1. Find employee with long name
2. Verify text truncation/wrapping

**Expected:**
- ✅ Text doesn't overflow
- ✅ Name is readable
- ✅ Layout remains intact

**Result:** ☐ Pass / ☐ Fail

---

### Edge Case 4: Empty Database
```
Objective: Verify behavior with no employees
```

**Steps:**
1. (Requires special setup - skip if not applicable)
2. Verify "검색 결과 없음" displays
3. Verify form can't be submitted without selection

**Result:** ☐ Pass / ☐ Fail / ☐ N/A

---

## Final Verification Summary

### All Quick Tests (5 min)
- ☐ Build successful
- ☐ Dev server running
- ☐ Login works
- ☐ Dialog opens
- ☐ Search works
- ☐ Selection works
- ☐ Dialog cleanup works

### All Feature Tests (15 min)
- ☐ Name search works
- ☐ Branch search works
- ☐ Department search works
- ☐ Case insensitivity works
- ☐ Selection persistence works
- ☐ Form submission works

### All Performance Tests (5 min)
- ☐ Response times acceptable
- ☐ No console errors
- ☐ No network errors

### All Browser Tests (10 min)
- ☐ Chrome works
- ☐ Firefox works
- ☐ Safari works (if available)
- ☐ Edge works (if available)

### All Mobile Tests (10 min)
- ☐ iOS responsive
- ☐ Android responsive

### All Edge Case Tests (10 min)
- ☐ Rapid searching works
- ☐ Special characters handled
- ☐ Long names display correctly
- ☐ Empty state handled

---

## Overall Status

### Total Tests: 42
- Passed: ☐
- Failed: ☐
- Skipped: ☐

### Overall Result: 

**☐ PASS - Ready for Production**

**☐ FAIL - Issues Found (see details below)**

**☐ SKIP - Manual Testing Skipped**

---

## Issues Found

If any tests failed, document issues here:

**Issue #1:**
- Feature: ________________
- Description: ________________
- Severity: ☐ High / ☐ Medium / ☐ Low
- Solution: ________________

**Issue #2:**
- Feature: ________________
- Description: ________________
- Severity: ☐ High / ☐ Medium / ☐ Low
- Solution: ________________

---

## Tester Information

**Name:** ________________

**Date:** ________________

**Time Spent:** __________ minutes

**Browser:** __________________

**OS:** __________________

**Device:** ☐ Desktop / ☐ Tablet / ☐ Mobile

---

## Approval Sign-Off

**QA Manager:** ________________ Date: ________

**Development Lead:** ________________ Date: ________

**Product Manager:** ________________ Date: ________

---

## Additional Notes

_____________________________________________________________

_____________________________________________________________

_____________________________________________________________

_____________________________________________________________

---

## Next Steps After Verification

- ☐ All tests passed → Ready for staging deployment
- ☐ Issues found → Create bug tickets and assign to dev team
- ☐ Issues fixed → Re-run failed test cases
- ☐ All tests passing → Proceed to production deployment

---

**Document Version:** 1.0
**Last Updated:** 2026-05-29
**Status:** Ready for Testing
