@testing
@https://github.com/DonJayamanne/pyvscSmokeTesting/testing
Feature: Test Explorer (code nav)
    Background: Activted Extension
        Given a file named ".vscode/settings.json" is created with the following content
            """
            {
                "python.testing.unittestArgs": [
                    "-v",
                    "-s",
                    "./tests",
                    "-p",
                    "test_*.py"
                ],
                "python.testing.unittestEnabled": false,
                "python.testing.pytestArgs": [
                    "."
                ],
                "python.testing.pytestEnabled": false,
                "python.testing.nosetestArgs": [
                    "."
                ],
                "python.testing.nosetestsEnabled": false
            }
            """
        Given the Python extension has been activated

    Scenario Outline: When navigating to a test file, suite & test, then open the file and set the cursor at the right line (<package>)
        Given the package "<package>" is installed
        And the workspace setting "python.testing.<setting_to_enable>" is enabled
        When I select the command "Python: Discover Tests"
        And I wait for test discovery to complete
        Then the test explorer icon will be visible
        When I select the command "View: Show Test"
        And I expand all of the nodes in the test explorer
        And I navigate to the code associated with the test node "<node_label>"
        Then the file "<file>" is opened
        And <optionally_check_line>

        Examples:
            | package  | setting_to_enable | node_label             | file        | optionally_check_line    |
            | unittest | unittestEnabled   | test_one.py            | test_one.py | do nothing               |
            | unittest | unittestEnabled   | test_one_first_suite   | test_one.py | the cursor is on line 20 |
            | unittest | unittestEnabled   | test_three_first_suite | test_one.py | the cursor is on line 30 |
            | unittest | unittestEnabled   | test_two_first_suite   | test_one.py | the cursor is on line 25 |
            | pytest   | pytestEnabled     | test_one.py            | test_one.py | do nothing               |
            | pytest   | pytestEnabled     | test_one_first_suite   | test_one.py | the cursor is on line 20 |
            | pytest   | pytestEnabled     | test_three_first_suite | test_one.py | the cursor is on line 30 |
            | pytest   | pytestEnabled     | test_two_first_suite   | test_one.py | the cursor is on line 25 |
            | nose     | nosetestsEnabled  | tests/test_one.py      | test_one.py | do nothing               |
            | nose     | nosetestsEnabled  | test_one_first_suite   | test_one.py | the cursor is on line 20 |
            | nose     | nosetestsEnabled  | test_three_first_suite | test_one.py | the cursor is on line 30 |
            | nose     | nosetestsEnabled  | test_two_first_suite   | test_one.py | the cursor is on line 25 |

    Scenario Outline: When selecting a node, then open the file (<package>)
        Given the package "<package>" is installed
        And the workspace setting "python.testing.<setting_to_enable>" is enabled
        When I select the command "Python: Discover Tests"
        And I wait for test discovery to complete
        Then the test explorer icon will be visible
        When I select the command "View: Show Test"
        And I expand all of the nodes in the test explorer
        When I click the test node with the label "<node_label>"
        Then the file "<file>" is opened

        Examples:
            | package  | setting_to_enable | node_label             | file        |
            | unittest | unittestEnabled   | TestFirstSuite         | test_one.py |
            | unittest | unittestEnabled   | test_one_first_suite   | test_one.py |
            | unittest | unittestEnabled   | test_three_first_suite | test_one.py |
            | unittest | unittestEnabled   | test_two_third_suite   | test_two.py |
            | pytest   | pytestEnabled     | TestFirstSuite         | test_one.py |
            | pytest   | pytestEnabled     | test_one_first_suite   | test_one.py |
            | pytest   | pytestEnabled     | test_three_first_suite | test_one.py |
            | pytest   | pytestEnabled     | test_two_third_suite   | test_two.py |
            | nose     | nosetestsEnabled  | TestFirstSuite         | test_one.py |
            | nose     | nosetestsEnabled  | test_one_first_suite   | test_one.py |
            | nose     | nosetestsEnabled  | test_three_first_suite | test_one.py |
            | nose     | nosetestsEnabled  | test_two_third_suite   | test_two.py |
