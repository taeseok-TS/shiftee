# Employee Search Feature - Test Plan

## Test Environment Setup

### Prerequisites
- Dev server running on localhost:3000
- Admin/Manager user account for testing
- Database populated with 100+ employees
- Browser console open for error checking

### Test Server Status
✅ Dev server: Running on localhost:3000
✅ Build: Successful with no errors
✅ Routes: All compiled and ready

## Test Scenarios

### Scenario 1: Dialog Opening and Initial State
**Expected Behavior:**
- Dialog opens cleanly
- Search input is empty
- No employee is selected (blue box not visible)
- Employee list is fully visible (all employees showing)

**Steps:**
1. Navigate to /contracts page
2. Click "계약서 작성" button
3. Verify search input is empty
4. Verify no blue selection box is visible
5. Verify all employees appear in the list

**Pass/Fail:** ____

---

### Scenario 2: Search by Employee Name
**Expected Behavior:**
- Typing employee name filters the list
- Only employees matching the search appear
- Search is case-insensitive
- Partial matches work (e.g., "김" matches "김철수", "김영희")

**Steps:**
1. Click "계약서 작성" button
2. Type "김" in search input
3. Verify only employees with "김" in their name appear
4. Type "김영" 
5. Verify further filtering to more specific matches
6. Clear search input
7. Verify all employees reappear

**Test Cases:**
- Search: "김" → Should match multiple employees
- Search: "이" → Should match multiple employees
- Search: "박영미" → Should match specific employee if exists
- Search: "zzz" → Should show "검색 결과 없음"

**Pass/Fail:** ____

---

### Scenario 3: Search by Branch
**Expected Behavior:**
- Typing branch name filters by branch
- Works with full branch names
- Works with partial branch names
- Case-insensitive

**Steps:**
1. Click "계약서 작성" button
2. Type branch name (e.g., "서울")
3. Verify only employees from that branch appear
4. Type more specific branch name
5. Verify further filtering
6. Clear search input

**Test Cases:**
- Search: "서울" → Employees from 서울 branch
- Search: "강남" → Employees from 강남 branch
- Search: "성남" → Employees from 성남 branch
- Search: "xyz" → Should show "검산 결과 없음"

**Pass/Fail:** ____

---

### Scenario 4: Search by Department
**Expected Behavior:**
- Typing department filters by department
- Works with full department names
- Works with partial department names
- Case-insensitive

**Steps:**
1. Click "계약서 작성" button
2. Type department name (e.g., "개발")
3. Verify only employees from that department appear
4. Type different department
5. Verify filtering changes
6. Clear search input

**Test Cases:**
- Search: "개발" → Employees from development department
- Search: "영업" → Employees from sales department
- Search: "인사" → Employees from HR department
- Search: "불가능" → Should show "검색 결과 없음"

**Pass/Fail:** ____

---

### Scenario 5: Employee Selection
**Expected Behavior:**
- Clicking employee button selects it
- Selected employee name appears in blue box
- Search input clears after selection
- Selected employee is highlighted in the list
- Selected employee can be submitted in form

**Steps:**
1. Click "계약서 작성" button
2. Type search to find an employee (e.g., "김")
3. Click one of the filtered employees
4. Verify blue selection box appears with employee name
5. Verify search input is now empty
6. Verify that employee has blue background in list
7. Continue with form submission

**Pass/Fail:** ____

---

### Scenario 6: Multiple Sequential Selections
**Expected Behavior:**
- Selecting different employees changes the selection
- Previous selection is replaced
- No duplicate selections occur

**Steps:**
1. Click "계약서 작성" button
2. Search and select "직원A"
3. Verify blue box shows "직원A"
4. Search and select "직원B"
5. Verify blue box shows "직원B" (not "직원A")
6. Verify only one employee is selected

**Pass/Fail:** ____

---

### Scenario 7: "검색 결과 없음" Display
**Expected Behavior:**
- Message appears only when:
  - User has typed in the search box
  - No employees match the search
- Message disappears when:
  - Search text is cleared
  - Results are found

**Steps:**
1. Click "계약서 작성" button
2. Type "불가능한직원이름"
3. Verify "검색 결과 없음" message appears centered
4. Clear search input
5. Verify message disappears
6. Verify all employees reappear

**Pass/Fail:** ____

---

### Scenario 8: Dialog Cleanup on Close
**Expected Behavior:**
- When dialog is closed, all temporary state is cleared
- Reopening dialog shows clean state
- Previous search/selection not retained

**Steps:**
1. Click "계약서 작성" button
2. Type search: "김"
3. Select an employee (blue box shows)
4. Click X or outside dialog to close (WITHOUT submitting)
5. Click "계약서 작성" again
6. Verify search input is empty
7. Verify no employee is selected (no blue box)
8. Verify all employees are visible again

**Pass/Fail:** ____

---

### Scenario 9: Form Submission
**Expected Behavior:**
- Selected employee is submitted with form
- Contract is created with correct userId
- Dialog closes after successful submission
- Success toast message appears

**Steps:**
1. Click "계약서 작성" button
2. Search and select an employee
3. Fill in other required fields:
   - Title: "테스트 계약서"
   - Type: "근로계약서" (or other)
   - File: Upload a file (if not using template)
4. Click submit button
5. Verify success message appears
6. Verify dialog closes
7. Verify new contract appears in list with correct employee

**Pass/Fail:** ____

---

### Scenario 10: Keyboard Navigation
**Expected Behavior:**
- User can type naturally in search field
- Tab key can navigate to employee buttons
- Enter key or click selects employee

**Steps:**
1. Click "계약서 작성" button
2. Type search text
3. Verify focus is on search input
4. Press Tab to move focus to first result
5. Press Enter to select
6. Verify selection is registered

**Pass/Fail:** ____

---

### Scenario 11: Responsive Design
**Expected Behavior:**
- Search input is fully visible
- Employee list fits in bounded height
- No horizontal scrolling
- Text truncation/wrapping works properly

**Test on Viewport Sizes:**
- Desktop: 1920x1080 ✓
- Laptop: 1366x768 ✓
- Tablet: 768x1024 ✓
- Mobile: 375x812 ✓

**Pass/Fail:** ____

---

### Scenario 12: Error States
**Expected Behavior:**
- If no employees in list: Show "검색 결과 없음"
- If employee list fails to load: Show error/retry

**Steps:**
1. Check browser console for JavaScript errors
2. Verify API call to /api/employees succeeds
3. Verify employee list populates correctly
4. Test with various search inputs

**Pass/Fail:** ____

---

### Scenario 13: Accessibility
**Expected Behavior:**
- Labels are associated with inputs
- Button text is descriptive
- Color contrast meets WCAG standards
- Screen reader compatibility

**Steps:**
1. Use accessibility checker (e.g., axe DevTools)
2. Check for:
   - Missing alt text
   - Missing labels
   - Color contrast issues
   - ARIA attributes

**Pass/Fail:** ____

---

## Browser Console Verification

Check console for errors:
```javascript
// Should show no errors related to:
// - State management
// - Event handlers
// - Filter logic
// - API calls
```

**Expected Console Output:**
- No JavaScript errors
- No warnings about props
- No network errors in Network tab
- Successful API responses for /api/employees

---

## Performance Testing

### Initial Load
- Employee list loads in < 1 second
- No noticeable lag when typing

### Search Response
- Filter results appear instantly as typing
- No jank or layout shift

### Selection
- Selection registers immediately on click
- Dialog doesn't freeze or stutter

**Metric:** Response time for each action should be < 100ms

---

## Bug Report Template

If issues are found:

```markdown
## Bug: [Brief Title]

**Steps to Reproduce:**
1. [Step 1]
2. [Step 2]
3. ...

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happened]

**Screenshot/Video:**
[If applicable]

**Console Error:**
[Copy full error from browser console]

**Environment:**
- Browser: [Chrome/Firefox/Safari/Edge]
- OS: [Windows/Mac/Linux]
- Screen Size: [e.g., 1920x1080]
```

---

## Sign-Off

**Tester Name:** _______________

**Date:** _______________

**Overall Status:** 
- [ ] All scenarios passed
- [ ] Some scenarios failed (see bug reports)
- [ ] Major issues found (blocking release)

**Comments:**

_______________________________________________________________

_______________________________________________________________

---

## Additional Notes

### Performance Expectations
- With 100 employees: Filter should be instant
- With 1000 employees: May need debouncing (future enhancement)
- Current implementation uses client-side filtering (no API calls)

### Future Improvements
1. Add keyboard navigation (arrow keys, Enter)
2. Implement search history
3. Add debouncing for very large lists
4. Highlight matched text in results
5. Group results by department/branch
6. Add employee avatars if available

### Known Limitations
1. No employee avatars currently shown
2. No keyboard arrow key navigation
3. No search debouncing (not needed for current size)
4. Mobile: May need scroll optimization

---

## Test Data Checklist

Ensure test database has:
- [ ] 100+ employees total
- [ ] Multiple branches (서울, 강남, 성남, etc.)
- [ ] Multiple departments (개발, 영업, 인사, etc.)
- [ ] Mix of Hangul names for proper search testing
- [ ] Some employees with same first/last name
- [ ] Some employees without branch/department info

---

## Regression Testing

After any code changes, verify:
- [ ] Contract creation still works
- [ ] Other form fields still work
- [ ] Dialog open/close works
- [ ] File upload still works
- [ ] Template selection still works
- [ ] Form submission with employee works
