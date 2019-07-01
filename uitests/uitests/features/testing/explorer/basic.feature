@testing
@https://github.com/DonJayamanne/pyvscSmokeTesting/testing
Feature: Test Explorer
    Background: Activted Extension
        Given a file named ".vscode/settings.json" is created with the following contents
            """
            {
                "python.testing.unittestArgs": [
                    "-v",
                    "-s",
                    "./tests",
                    "-p",
                    "test_*.py"
                ],
                "python.testing.unittestEnabled": true,
                "python.testing.pytestArgs": ["."],
                "python.testing.pytestEnabled": false,
                "python.testing.nosetestArgs": ["."],
                "python.testing.nosetestsEnabled": false
            }
            """

    Scenario Outline: Explorer will be displayed when tests are discovered (<package>)
        Given the package "<package>" is installed
        And the workspace setting "python.testing.<setting_to_enable>" is enabled
        When I wait for the Python extension to activate
        And I select the command "Python: Discover Tests"
        Then the test explorer icon will be visible

        Examples:
            | package  | setting_to_enable |
            | unittest | unittestEnabled   |
            | pytest   | pytestEnabled     |
            | nose     | nosetestsEnabled  |

    Scenario Outline: All expected items are displayed in the test explorer (<package>)
        Given the package "<package>" is installed
        And the workspace setting "python.testing.<setting_to_enable>" is enabled
        When I wait for the Python extension to activate
        When I select the command "Python: Discover Tests"
        And I wait for tests discovery to complete
        Then the test explorer icon will be visible
        When I select the command "View: Show Test"
        And I expand all of the test tree nodes
        Then there are <node_count> nodes in the tree

        Examples:
            | package  | setting_to_enable | node_count |
            | unittest | unittestEnabled   | 14         |
            | pytest   | pytestEnabled     | 15         |
            | nose     | nosetestsEnabled  | 14         |

    Scenario Outline: When discovering tests, the nodes will have the progress icon and clicking stop will stop discovery (<package>)
        Given the package "<package>" is installed
        And the workspace setting "python.testing.<setting_to_enable>" is enabled
        When I wait for the Python extension to activate
        When I select the command "Python: Discover Tests"
        And I wait for tests discovery to complete
        Then the test explorer icon will be visible
        When I select the command "View: Show Test"
        And I expand all of the test tree nodes
        Then there are <node_count> nodes in the tree
        # Now, add a delay for the discovery of the tests
        Given a file named "tests/test_discovery_delay" is created with the following contents
            """
            10
            """
        When I select the command "Python: Discover Tests"
        And I wait for tests discovery to complete
        Then all of the test tree nodes have a progress icon
        And the stop icon is visible in the toolbar
        When I stop discovering tests
        Then the stop icon is not visible in the toolbar

        Examples:
            | package  | setting_to_enable | node_count |
            | unittest | unittestEnabled   | 14         |
            | pytest   | pytestEnabled     | 15         |
            | nose     | nosetestsEnabled  | 14         |
